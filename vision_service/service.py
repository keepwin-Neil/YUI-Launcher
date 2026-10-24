#!/usr/bin/env python3
"""Local-only face and pose analysis service for the private N.E.K.O launcher.

The Electron renderer owns the single camera capture. It sends downscaled JPEG
frames to this loopback-only process, which returns detection metadata. Frames
are decoded in memory and are never written to disk.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python.components.processors import classifier_options
from mediapipe.tasks.python import vision


MAX_FRAME_BYTES = 2 * 1024 * 1024
BODY_ANALYSIS_WIDTH = 640
BODY_ANALYSIS_HEIGHT = 360


def emit_status(
    phase: str,
    message: str,
    kind: str = "",
) -> None:
    """Emit a machine-readable startup phase for the Electron boot terminal."""

    payload = json.dumps(
        {
            "phase": phase,
            "message": message,
            "kind": kind,
        },
        ensure_ascii=True,
        separators=(",", ":"),
    )
    print(f"NEKO_VISION_STATUS:{payload}", flush=True)


def clamp01(value: float) -> float:
    """Clamp a numeric confidence value into the JSON-safe 0..1 range."""

    return max(0.0, min(1.0, float(value)))


def finite_float(
    value: float | None,
    *,
    default: float = 0.0,
) -> float:
    """Return a finite JSON-safe float for optional landmark values."""

    if value is None:
        return default

    normalized = float(value)
    return normalized if math.isfinite(normalized) else default


class VisionAnalyzer:
    """Owns the OpenSeeFace and MediaPipe model instances."""

    def __init__(self, project_dir: Path) -> None:
        emit_status(
            "MODEL_ASSETS_CHECKING",
            "[VISION] verifying local model assets and runtime paths",
        )
        self.project_dir = project_dir
        self.open_see_face_dir = (
            project_dir / "third_party" / "OpenSeeFace"
        )
        self.pose_model_path = (
            project_dir
            / "assets"
            / "models"
            / "vision"
            / "mediapipe"
            / "pose_landmarker_full.task"
        )
        self.gesture_model_path = (
            project_dir
            / "assets"
            / "models"
            / "vision"
            / "mediapipe"
            / "gesture_recognizer.task"
        )

        if not self.open_see_face_dir.is_dir():
            raise FileNotFoundError(
                f"OpenSeeFace directory not found: {self.open_see_face_dir}"
            )

        if not self.pose_model_path.is_file():
            raise FileNotFoundError(
                f"MediaPipe pose model not found: {self.pose_model_path}"
            )

        if not self.gesture_model_path.is_file():
            raise FileNotFoundError(
                "MediaPipe gesture model not found: "
                f"{self.gesture_model_path}"
            )

        emit_status(
            "MODEL_ASSETS_READY",
            "[OK] local vision assets verified; no remote model fetch required",
            "ok",
        )
        emit_status(
            "FACE_RUNTIME_LOADING",
            "[FACE] importing OpenSeeFace tracker runtime",
        )
        sys.path.insert(0, str(self.open_see_face_dir))
        from tracker import Tracker  # type: ignore[import-not-found]

        self.tracker_class = Tracker
        self.face_tracker: Any | None = None
        self.face_tracker_size: tuple[int, int] | None = None
        self.analysis_lock = threading.Lock()
        self.last_video_timestamp_ms = 0
        self.last_pose_for_face_validation: dict[str, Any] | None = None
        self.pose_validation_miss_count = 0

        emit_status(
            "POSE_MODEL_LOADING",
            "[POSE] loading MediaPipe pose_landmarker_full.task",
        )
        pose_options = vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(
                model_asset_path=str(self.pose_model_path)
            ),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.pose_landmarker = (
            vision.PoseLandmarker.create_from_options(pose_options)
        )
        emit_status(
            "POSE_MODEL_READY",
            "[OK] MediaPipe Pose Landmarker ready // 33 landmarks",
            "ok",
        )
        emit_status(
            "HAND_MODEL_LOADING",
            "[HAND] loading MediaPipe Gesture Recognizer // 21 landmarks",
        )
        gesture_options = vision.GestureRecognizerOptions(
            base_options=mp_python.BaseOptions(
                model_asset_path=str(self.gesture_model_path)
            ),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=2,
            min_hand_detection_confidence=0.45,
            min_hand_presence_confidence=0.45,
            min_tracking_confidence=0.6,
            canned_gesture_classifier_options=(
                classifier_options.ClassifierOptions(
                    max_results=1,
                    score_threshold=0.55,
                )
            ),
        )
        self.gesture_recognizer = (
            vision.GestureRecognizer.create_from_options(gesture_options)
        )
        emit_status(
            "HAND_MODEL_READY",
            "[OK] MediaPipe hands ready // hands=2 // landmarks=21",
            "ok",
        )
        emit_status(
            "FACE_MODEL_LOADING",
            "[FACE] loading OpenSeeFace RetinaFace and landmark ONNX graphs",
        )
        self._ensure_face_tracker(
            BODY_ANALYSIS_WIDTH,
            BODY_ANALYSIS_HEIGHT,
        )
        emit_status(
            "FACE_MODEL_READY",
            "[OK] OpenSeeFace models ready // input=640x360 // faces=1",
            "ok",
        )

    def close(self) -> None:
        """Release native model resources."""

        self.pose_landmarker.close()
        self.gesture_recognizer.close()

    def _ensure_face_tracker(self, width: int, height: int) -> None:
        size = (width, height)

        if self.face_tracker is not None and self.face_tracker_size == size:
            return

        self.face_tracker = self.tracker_class(
            width,
            height,
            model_type=1,
            detection_threshold=0.5,
            threshold=0.5,
            max_faces=1,
            discard_after=5,
            scan_every=3,
            max_threads=4,
            silent=True,
            model_dir=str(self.open_see_face_dir / "models"),
            no_gaze=True,
            use_retinaface=True,
            static_model=True,
            feature_level=1,
        )
        self.face_tracker_size = size

    @staticmethod
    def _face_payload(
        face: Any,
        width: int,
        height: int,
    ) -> dict[str, Any]:
        bbox = face.bbox
        # Keep the un-clamped geometry around for the center estimate. When a
        # face is partially outside the left/right frame edge, clamping the
        # bbox first drags the derived center toward the middle of the frame,
        # which visibly weakens the avatar's head turn exactly when the user
        # stands at the edge of the camera view.
        raw_left = float(bbox[1]) / width
        raw_top = float(bbox[0]) / height
        raw_width = float(bbox[3]) / width
        raw_height = float(bbox[2]) / height
        normalized_bbox = [
            clamp01(raw_left),
            clamp01(raw_top),
            clamp01(raw_width),
            clamp01(raw_height),
        ]

        landmarks: list[list[float]] = []
        for row, column, point_confidence in face.lms:
            landmarks.append(
                [
                    clamp01(float(column) / width),
                    clamp01(float(row) / height),
                    clamp01(float(point_confidence)),
                ]
            )

        head_pose: dict[str, float] | None = None
        euler = getattr(face, "euler", None)
        if (
            getattr(face, "success", False)
            and euler is not None
            and len(euler) >= 3
        ):
            # OpenSeeFace's frontal X rotation is represented around +180 or
            # -180 degrees. Fold it around that pole so a frontal face becomes
            # approximately 0 degrees before driving the avatar's gaze.
            pitch = finite_float(euler[0])
            if pitch > 90.0:
                pitch -= 180.0
            elif pitch < -90.0:
                pitch += 180.0

            head_pose = {
                "pitch": max(
                    -90.0,
                    min(90.0, pitch),
                ),
                "yaw": max(
                    -90.0,
                    min(90.0, finite_float(euler[1])),
                ),
                "roll": max(
                    -180.0,
                    min(180.0, finite_float(euler[2])),
                ),
                "fit_error": max(
                    0.0,
                    min(
                        10_000.0,
                        finite_float(
                            getattr(face, "pnp_error", 0.0)
                        ),
                    ),
                ),
            }

        return {
            "confidence": clamp01(face.conf),
            "bbox": normalized_bbox,
            "center": [
                clamp01(raw_left + raw_width / 2),
                clamp01(raw_top + raw_height / 2),
            ],
            "size": clamp01(
                math.sqrt(
                    normalized_bbox[2]
                    * normalized_bbox[3]
                )
            ),
            "head_pose": head_pose,
            "landmarks": landmarks,
        }

    @staticmethod
    def _pose_payload(
        pose_result: Any,
    ) -> dict[str, Any] | None:
        if not pose_result.pose_landmarks:
            return None

        landmarks = pose_result.pose_landmarks[0]
        payload_landmarks: list[list[float]] = []

        for landmark in landmarks:
            payload_landmarks.append(
                [
                    clamp01(landmark.x),
                    clamp01(landmark.y),
                    clamp01(landmark.visibility),
                    clamp01(landmark.presence),
                ]
            )

        # Core joints provide a useful real confidence for a visible upper or
        # full body without allowing one hidden fingertip to dominate it.
        core_indices = (
            0,
            11,
            12,
            13,
            14,
            15,
            16,
            23,
            24,
            25,
            26,
        )
        core_confidences = [
            min(
                payload_landmarks[index][2],
                payload_landmarks[index][3],
            )
            for index in core_indices
            if index < len(payload_landmarks)
        ]
        confidence = (
            float(np.mean(core_confidences))
            if core_confidences
            else 0.0
        )

        return {
            "confidence": clamp01(confidence),
            "landmarks": payload_landmarks,
        }

    @staticmethod
    def _pose_face_payload(
        pose: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Build a conservative head target from reliable pose landmarks."""

        if not pose or float(pose.get("confidence", 0.0)) < 0.35:
            return None

        landmarks = pose.get("landmarks")
        if not isinstance(landmarks, list) or not landmarks:
            return None

        def point(index: int) -> list[float] | None:
            if index >= len(landmarks):
                return None
            candidate = landmarks[index]
            if not isinstance(candidate, list) or len(candidate) < 4:
                return None
            confidence = min(
                finite_float(candidate[2]),
                finite_float(candidate[3]),
            )
            return candidate if confidence >= 0.38 else None

        nose = point(0)
        head_points = [
            candidate
            for index in range(0, 11)
            if (candidate := point(index)) is not None
        ]
        if nose is None and len(head_points) < 3:
            return None

        if nose is None:
            center_x = float(
                np.mean([candidate[0] for candidate in head_points])
            )
            center_y = float(
                np.mean([candidate[1] for candidate in head_points])
            )
        else:
            center_x = finite_float(nose[0], default=0.5)
            center_y = finite_float(nose[1], default=0.5)

        head_x_values = [
            finite_float(candidate[0])
            for candidate in head_points
        ]
        head_y_values = [
            finite_float(candidate[1])
            for candidate in head_points
        ]
        head_span_x = (
            max(head_x_values) - min(head_x_values)
            if len(head_x_values) >= 2
            else 0.0
        )
        head_span_y = (
            max(head_y_values) - min(head_y_values)
            if len(head_y_values) >= 2
            else 0.0
        )

        left_shoulder = point(11)
        right_shoulder = point(12)
        shoulder_width = (
            abs(
                finite_float(left_shoulder[0])
                - finite_float(right_shoulder[0])
            )
            if left_shoulder is not None
            and right_shoulder is not None
            else 0.0
        )
        width = max(
            0.09,
            head_span_x * 1.45,
            shoulder_width * 0.34,
        )
        width = min(0.38, width)
        height = max(
            0.12,
            head_span_y * 1.9,
            width * 1.18,
        )
        height = min(0.45, height)

        left = clamp01(center_x - width / 2)
        top = clamp01(center_y - height * 0.48)
        right = clamp01(left + width)
        bottom = clamp01(top + height)
        width = max(0.01, right - left)
        height = max(0.01, bottom - top)
        point_confidences = [
            min(
                finite_float(candidate[2]),
                finite_float(candidate[3]),
            )
            for candidate in head_points
        ]
        head_confidence = (
            float(np.mean(point_confidences))
            if point_confidences
            else float(pose.get("confidence", 0.0))
        )

        return {
            "confidence": clamp01(
                min(
                    float(pose.get("confidence", 0.0)),
                    head_confidence,
                )
                * 0.92
            ),
            "bbox": [left, top, width, height],
            "center": [
                clamp01(center_x),
                clamp01(center_y),
            ],
            "size": clamp01(math.sqrt(width * height)),
            "head_pose": None,
            "landmarks": [],
            "tracking_source": "pose_head",
        }

    @classmethod
    def _fuse_face_with_pose(
        cls,
        face: dict[str, Any] | None,
        pose: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Reject a face box that disagrees with the current body pose."""

        pose_face = cls._pose_face_payload(pose)
        if face is None:
            return pose_face
        if pose_face is None:
            return {
                **face,
                "tracking_source": "open_see_face",
            }

        face_center = face.get("center", [0.5, 0.5])
        pose_center = pose_face["center"]
        face_bbox = face.get("bbox", [0.0, 0.0, 0.0, 0.0])
        pose_bbox = pose_face["bbox"]
        delta_x = abs(
            finite_float(face_center[0], default=0.5)
            - finite_float(pose_center[0], default=0.5)
        )
        delta_y = abs(
            finite_float(face_center[1], default=0.5)
            - finite_float(pose_center[1], default=0.5)
        )
        allowed_x = max(
            0.16,
            finite_float(face_bbox[2]) * 0.72,
            finite_float(pose_bbox[2]) * 0.90,
        )
        allowed_y = max(
            0.18,
            finite_float(face_bbox[3]) * 0.72,
            finite_float(pose_bbox[3]) * 0.90,
        )
        face_size_is_plausible = (
            0.025 <= finite_float(face_bbox[2]) <= 0.62
            and 0.035 <= finite_float(face_bbox[3]) <= 0.72
        )

        if (
            face_size_is_plausible
            and delta_x <= allowed_x
            and delta_y <= allowed_y
        ):
            return {
                **face,
                "tracking_source": "face_pose_validated",
            }

        return {
            **pose_face,
            "rejected_face_confidence": clamp01(
                finite_float(face.get("confidence"))
            ),
        }

    @staticmethod
    def _hands_payload(
        gesture_result: Any,
    ) -> list[dict[str, Any]]:
        hands: list[dict[str, Any]] = []

        for index, landmarks in enumerate(
            gesture_result.hand_landmarks
        ):
            payload_landmarks = [
                [
                    clamp01(finite_float(landmark.x)),
                    clamp01(finite_float(landmark.y)),
                    max(
                        -2.0,
                        min(
                            2.0,
                            finite_float(landmark.z),
                        ),
                    ),
                ]
                for landmark in landmarks
            ]

            handedness = (
                gesture_result.handedness[index][0]
                if index < len(gesture_result.handedness)
                and gesture_result.handedness[index]
                else None
            )
            handedness_name = str(
                getattr(handedness, "category_name", "")
                or "Unknown"
            ).lower()
            handedness_score = clamp01(
                finite_float(
                    getattr(handedness, "score", 0.0)
                )
            )

            gesture = (
                gesture_result.gestures[index][0]
                if index < len(gesture_result.gestures)
                and gesture_result.gestures[index]
                else None
            )
            gesture_name = str(
                getattr(gesture, "category_name", "")
                or "None"
            )
            gesture_score = clamp01(
                finite_float(
                    getattr(gesture, "score", 0.0)
                )
            )

            palm_indices = (0, 5, 9, 13, 17)
            palm_points = [
                payload_landmarks[palm_index]
                for palm_index in palm_indices
                if palm_index < len(payload_landmarks)
            ]
            palm_center = [
                float(
                    np.mean(
                        [point[0] for point in palm_points]
                    )
                ),
                float(
                    np.mean(
                        [point[1] for point in palm_points]
                    )
                ),
            ]
            x_values = [
                point[0] for point in payload_landmarks
            ]
            y_values = [
                point[1] for point in payload_landmarks
            ]

            hands.append(
                {
                    "confidence": handedness_score,
                    "handedness": handedness_name,
                    "gesture": {
                        "name": gesture_name,
                        "confidence": gesture_score,
                    },
                    "palm_center": palm_center,
                    "bbox": [
                        min(x_values),
                        min(y_values),
                        max(x_values) - min(x_values),
                        max(y_values) - min(y_values),
                    ],
                    "landmarks": payload_landmarks,
                }
            )

        return hands

    @staticmethod
    def _summary(
        face: dict[str, Any] | None,
        pose: dict[str, Any] | None,
        hands: list[dict[str, Any]],
    ) -> tuple[str, float]:
        labels: list[str] = []
        confidences: list[float] = []

        if face is not None:
            labels.append("FACE")
            confidences.append(float(face["confidence"]))

        if pose is not None:
            labels.append("POSE")
            confidences.append(float(pose["confidence"]))

        if hands:
            labels.append("HANDS")
            confidences.append(
                max(
                    float(hand["confidence"])
                    for hand in hands
                )
            )

        if not labels:
            return ("NO TARGET", 0.0)

        return (" + ".join(labels), min(confidences))

    def analyze(self, jpeg_bytes: bytes) -> dict[str, Any]:
        """Analyze one JPEG frame and return only derived metadata."""

        encoded = np.frombuffer(jpeg_bytes, dtype=np.uint8)
        frame = cv2.imdecode(encoded, cv2.IMREAD_COLOR)

        if frame is None or frame.size == 0:
            raise ValueError("The submitted frame is not a valid image.")

        height, width = frame.shape[:2]
        body_frame = cv2.resize(
            frame,
            (BODY_ANALYSIS_WIDTH, BODY_ANALYSIS_HEIGHT),
            interpolation=cv2.INTER_AREA,
        )

        with self.analysis_lock:
            started_at = time.perf_counter()
            self._ensure_face_tracker(
                BODY_ANALYSIS_WIDTH,
                BODY_ANALYSIS_HEIGHT,
            )

            faces = self.face_tracker.predict(body_frame)
            face = (
                self._face_payload(
                    faces[0],
                    BODY_ANALYSIS_WIDTH,
                    BODY_ANALYSIS_HEIGHT,
                )
                if faces
                else None
            )

            body_rgb_frame = cv2.cvtColor(
                body_frame,
                cv2.COLOR_BGR2RGB,
            )
            body_mp_image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=body_rgb_frame,
            )
            hand_rgb_frame = cv2.cvtColor(
                frame,
                cv2.COLOR_BGR2RGB,
            )
            hand_mp_image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=hand_rgb_frame,
            )
            timestamp_ms = time.monotonic_ns() // 1_000_000
            timestamp_ms = max(
                timestamp_ms,
                self.last_video_timestamp_ms + 1,
            )
            self.last_video_timestamp_ms = timestamp_ms

            pose_result = self.pose_landmarker.detect_for_video(
                body_mp_image,
                timestamp_ms,
            )
            gesture_result = (
                self.gesture_recognizer.recognize_for_video(
                    hand_mp_image,
                    timestamp_ms,
                )
            )
            pose = self._pose_payload(pose_result)
            if pose is not None:
                self.last_pose_for_face_validation = pose
                self.pose_validation_miss_count = 0
                pose_for_face_validation = pose
            else:
                self.pose_validation_miss_count += 1
                pose_for_face_validation = (
                    self.last_pose_for_face_validation
                    if self.pose_validation_miss_count <= 3
                    else None
                )
            face = self._fuse_face_with_pose(
                face,
                pose_for_face_validation,
            )
            if (
                pose is None
                and face is not None
                and pose_for_face_validation is not None
            ):
                source = str(face.get("tracking_source", ""))
                if source:
                    face["tracking_source"] = f"{source}_grace"
            hands = self._hands_payload(gesture_result)
            output, confidence = self._summary(
                face,
                pose,
                hands,
            )
            elapsed_ms = (
                time.perf_counter() - started_at
            ) * 1000.0

        return {
            "ok": True,
            "output": output,
            "confidence": clamp01(confidence),
            "face": face,
            "pose": pose,
            "hands": hands,
            "frame": {
                "width": width,
                "height": height,
            },
            "processing_ms": round(elapsed_ms, 1),
        }


class VisionRequestHandler(BaseHTTPRequestHandler):
    """Minimal loopback HTTP API for Electron's main process."""

    server_version = "NekoVision/1.0"

    @property
    def analyzer(self) -> VisionAnalyzer:
        return self.server.analyzer  # type: ignore[attr-defined]

    def log_message(self, format_string: str, *args: object) -> None:
        sys.stderr.write(
            "%s - - [%s] %s\n"
            % (
                self.client_address[0],
                self.log_date_time_string(),
                format_string % args,
            )
        )

    def _send_json(
        self,
        status: HTTPStatus,
        payload: dict[str, Any],
    ) -> None:
        body = json.dumps(
            payload,
            ensure_ascii=True,
            separators=(",", ":"),
        ).encode("utf-8")

        self.send_response(status.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path != "/health":
            self._send_json(
                HTTPStatus.NOT_FOUND,
                {"ok": False, "error": "not_found"},
            )
            return

        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "service": "neko-vision",
                "camera_owner": "electron",
                "stores_frames": False,
            },
        )

    def do_POST(self) -> None:
        if self.path != "/analyze":
            self._send_json(
                HTTPStatus.NOT_FOUND,
                {"ok": False, "error": "not_found"},
            )
            return

        try:
            content_length = int(
                self.headers.get("Content-Length", "0")
            )
        except ValueError:
            content_length = 0

        if content_length <= 0 or content_length > MAX_FRAME_BYTES:
            self._send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {
                    "ok": False,
                    "error": "invalid_frame_size",
                },
            )
            return

        jpeg_bytes = self.rfile.read(content_length)

        try:
            result = self.analyzer.analyze(jpeg_bytes)
        except Exception as error:
            self._send_json(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                {
                    "ok": False,
                    "error": type(error).__name__,
                    "message": str(error),
                },
            )
            return

        self._send_json(HTTPStatus.OK, result)


class VisionHttpServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address: tuple[str, int],
        analyzer: VisionAnalyzer,
    ) -> None:
        super().__init__(server_address, VisionRequestHandler)
        self.analyzer = analyzer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="N.E.K.O local face, pose, and hand analysis service"
    )
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path(
            os.environ.get(
                "NEKO_PROJECT_DIR",
                Path.home() / "Projects" / "N.E.K.O",
            )
        ),
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("NEKO_VISION_PORT", "48913")),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    project_dir = args.project_dir.expanduser().resolve()
    emit_status(
        "PYTHON_RUNTIME_READY",
        "[VISION] isolated Python runtime online",
        "sync",
    )
    analyzer = VisionAnalyzer(project_dir)
    server = VisionHttpServer(
        ("127.0.0.1", args.port),
        analyzer,
    )

    print(
        "N.E.K.O vision service ready at "
        f"http://127.0.0.1:{args.port}; "
        "frames are processed in memory only.",
        flush=True,
    )
    emit_status(
        "VISION_SERVICE_READY",
        "[OK] face, pose, and hand analysis listening on loopback:48913",
        "ok",
    )

    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        analyzer.close()


if __name__ == "__main__":
    main()
