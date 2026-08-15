from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN_ROOT / "py_modules"))

from armada_control import back_paddles, calibration, cpu_limit, emulation_broker as emulation, fan_control, joystick_led, lsfg, paddle_actions, paddle_daemon, power, runtime, system  # noqa: E402


class JoystickLedTests(unittest.TestCase):
    def test_named_color_presets_write_exact_rgb_channels(self):
        expected = {
            "red": (255, 0, 0),
            "green": (0, 255, 0),
            "blue": (0, 0, 255),
            "cyan": (0, 255, 255),
            "magenta": (255, 0, 255),
            "yellow": (255, 255, 0),
            "orange": (255, 128, 0),
            "purple": (128, 0, 255),
            "white": (255, 255, 255),
        }
        self.assertEqual(
            {name: joystick_led._hex_to_rgb_dec(value) for name, value in joystick_led.COLOR_PRESETS.items()},
            expected,
        )

    def test_softened_legacy_preset_is_normalized_without_altering_custom_colors(self):
        legacy = joystick_led._normalize_side({"mode": "solid", "color": "#ff2020", "brightness": 70})
        custom = joystick_led._normalize_side({"mode": "solid", "color": "#123456", "brightness": 70})
        self.assertEqual(legacy["color"], "#ff0000")
        self.assertEqual(custom["color"], "#123456")

    def test_off_blanks_accents_without_disabling_status_service(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config = root / "joystick-led.json"
            config.write_text(
                json.dumps(
                    {
                        "left": {"mode": "solid", "color": "#2080ff", "brightness": 70},
                        "right": {"mode": "solid", "color": "#2080ff", "brightness": 70},
                        "linked": True,
                    }
                ),
                encoding="utf-8",
            )
            led_root = root / "leds"
            accent = led_root / "rgb:l1"
            accent.mkdir(parents=True)
            (accent / "multi_intensity").write_text("1 2 3", encoding="utf-8")
            settings = []
            commands = []
            with (
                mock.patch.object(joystick_led, "CONFIG_PATH", config),
                mock.patch.object(joystick_led, "LED_SYSFS", led_root),
                mock.patch.object(joystick_led, "settings_set_many", side_effect=lambda values: settings.extend(values)),
                mock.patch.object(joystick_led, "_run", side_effect=lambda command: commands.append(command) or ""),
            ):
                state = joystick_led.save_state(
                    {"left": {"mode": "off", "color": "#2080ff", "brightness": 0}}
                )

            self.assertEqual(state["config"]["left"]["mode"], "off")
            self.assertEqual(state["config"]["left"]["brightness"], 70)
            self.assertIn(("led.enabled", "1"), settings)
            self.assertIn(("led.colour", "0 0 0"), settings)
            self.assertNotIn(("led.enabled", "0"), settings)
            self.assertFalse(any("stop" in command for command in commands))
            self.assertFalse(any("power-led" in " ".join(command) for command in commands))


class SystemSettingsTests(unittest.TestCase):
    def test_batches_settings_and_repairs_known_writer_race_damage(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            conf = root / "batocera.conf"
            lock = root / "settings.lock"
            conf.write_bytes(b"display.brightness=70\n\0\0\0\0\n70\n")
            commands = []

            def command(args, **_kwargs):
                commands.append(args)
                data = conf.read_text(encoding="latin1").splitlines()
                values = {}
                order = []
                for line in data:
                    if not line or line.lstrip().startswith("#") or "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    values[key] = value
                    order.append(key)
                pairs = args[2:]
                for index in range(0, len(pairs), 2):
                    key, value = pairs[index:index + 2]
                    if key not in values:
                        order.append(key)
                    values[key] = value
                conf.write_text("".join(f"{key}={values[key]}\n" for key in order), encoding="latin1")
                return subprocess.CompletedProcess(args, 0, "", "")

            with (
                mock.patch.object(system, "BATOCERA_CONF", conf),
                mock.patch.object(system, "SETTINGS_LOCK", lock),
                mock.patch.object(system, "run_cmd", side_effect=command),
            ):
                system.settings_set_many([("led.enabled", "1"), ("led.mode", "static")])

            self.assertEqual(
                commands,
                [[system.BATOCERA_SETTINGS_SET, "--validate", "led.enabled", "1", "led.mode", "static"]],
            )
            result = conf.read_bytes()
            self.assertNotIn(b"\0", result)
            self.assertNotIn(b"\n70\n", result)
            self.assertIn(b"led.enabled=1\n", result)
            self.assertEqual(len(list(root.glob("batocera.conf.corrupt-*"))), 1)

    def test_refuses_unknown_invalid_lines_without_invoking_writer(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            conf = root / "batocera.conf"
            lock = root / "settings.lock"
            original = b"valid.key=1\nthis is not config\n"
            conf.write_bytes(original)
            with (
                mock.patch.object(system, "BATOCERA_CONF", conf),
                mock.patch.object(system, "SETTINGS_LOCK", lock),
                mock.patch.object(system, "run_cmd") as command,
            ):
                with self.assertRaisesRegex(RuntimeError, "invalid non-key/value"):
                    system.settings_set("valid.key", "2")
            command.assert_not_called()
            self.assertEqual(conf.read_bytes(), original)

    def test_failed_writer_restores_pre_transaction_config(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            conf = root / "batocera.conf"
            lock = root / "settings.lock"
            original = b"display.brightness=70\nvalid.key=1\n"
            conf.write_bytes(original)

            def failed_command(args, **_kwargs):
                conf.write_bytes(b"\0\0damaged")
                return subprocess.CompletedProcess(args, 1, "", "writer failed")

            with (
                mock.patch.object(system, "BATOCERA_CONF", conf),
                mock.patch.object(system, "SETTINGS_LOCK", lock),
                mock.patch.object(system, "run_cmd", side_effect=failed_command),
            ):
                with self.assertRaisesRegex(RuntimeError, "failed to persist"):
                    system.settings_set("valid.key", "2")

            self.assertEqual(conf.read_bytes(), original)
            self.assertEqual(len(list(root.glob("batocera.conf.corrupt-*"))), 1)

    def test_remove_setting_deletes_only_the_exact_active_key(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            conf = root / "batocera.conf"
            conf_lock = root / "batocera.conf.lock"
            plugin_lock = root / "settings.lock"
            conf.write_text(
                '# snes["Zelda.sfc"].ratio=commented\n'
                'snes["Zelda.sfc"].ratio=16/9\n'
                'snes["Zelda.sfc"].ratio_extra=keep\n',
                encoding="utf-8",
            )
            with (
                mock.patch.object(system, "BATOCERA_CONF", conf),
                mock.patch.object(system, "BATOCERA_CONF_LOCK", conf_lock),
                mock.patch.object(system, "SETTINGS_LOCK", plugin_lock),
            ):
                system.settings_remove('snes["Zelda.sfc"].ratio')

            result = conf.read_text(encoding="utf-8")
            self.assertIn('# snes["Zelda.sfc"].ratio=commented\n', result)
            self.assertNotIn('snes["Zelda.sfc"].ratio=16/9\n', result)
            self.assertIn('snes["Zelda.sfc"].ratio_extra=keep\n', result)


class EmulationSettingsTests(unittest.TestCase):
    def fixture(self, root: Path):
        managed_id = "0123456789abcdef01234567"
        manifest = root / "managed-games.json"
        manifest.write_text(
            json.dumps(
                {
                    "version": 1,
                    "enabled": True,
                    "games": {
                        managed_id: {
                            "id": managed_id,
                            "system": "snes",
                            "system_name": "Super Nintendo",
                            "rom": "/userdata/roms/snes/Zelda.sfc",
                            "name": "Zelda",
                            "enabled": True,
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        systems = root / "es_systems.cfg"
        systems.write_text(
            """<systemList><system><name>snes</name><emulators>
            <emulator name="libretro"><cores>
              <core default="true">snes9x</core><core>bsnes</core>
            </cores></emulator>
            <emulator name="mednafen"><cores><core>mednafen_snes</core></cores></emulator>
            </emulators></system></systemList>""",
            encoding="utf-8",
        )
        features = root / "es_features.cfg"
        features.write_text(
            """<features>
            <sharedFeatures>
              <feature name="GAME ASPECT RATIO" value="ratio">
                <choice name="4/3" value="4/3"/><choice name="16/9" value="16/9"/>
              </feature>
              <feature name="ENABLE GAMESCOPE" value="gamescope"><choice name="On" value="1"/></feature>
            </sharedFeatures>
            <globalFeatures><sharedFeature value="ratio"/><sharedFeature value="gamescope"/></globalFeatures>
            <emulator name="libretro"><cores>
              <core name="snes9x"><feature name="REWIND" value="rewind">
                <choice name="On" value="1"/><choice name="Off" value="0"/>
              </feature></core>
              <core name="bsnes"/>
            </cores></emulator>
            </features>""",
            encoding="utf-8",
        )
        conf = root / "batocera.conf"
        conf.write_text(
            "global.ratio=4/3\n"
            "snes.ratio=16/9\n"
            'snes.folder["/userdata/roms/snes"].ratio=4/3\n',
            encoding="utf-8",
        )
        appid = emulation._shortcut_appid(managed_id, "Zelda")
        return manifest, systems, features, conf, appid

    def patches(self, manifest, systems, features, conf):
        return (
            mock.patch.object(emulation, "MANIFEST_PATH", manifest),
            mock.patch.object(emulation, "ES_SYSTEMS_PATHS", (systems,)),
            mock.patch.object(emulation, "ES_FEATURES_PATHS", (features,)),
            mock.patch.object(emulation, "BATOCERA_CONF", conf),
            mock.patch.object(emulation, "SHADER_CONFIG_DIRS", ()),
        )

    def test_resolves_managed_appid_configgen_layers_and_filtered_features(self):
        with tempfile.TemporaryDirectory() as temp:
            manifest, systems, features, conf, appid = self.fixture(Path(temp))
            patches = self.patches(manifest, systems, features, conf)
            with patches[0], patches[1], patches[2], patches[3], patches[4]:
                state = emulation.get_state(str(appid))

            self.assertTrue(state["supported"])
            self.assertEqual(state["configPrefix"], 'snes["Zelda.sfc"]')
            self.assertEqual(state["emulator"]["effectiveValue"], "libretro")
            self.assertEqual(state["core"]["effectiveValue"], "snes9x")
            found = {
                item["setting"]: item
                for group in state["groups"]
                for item in group["features"]
            }
            self.assertEqual(found["ratio"]["inheritedValue"], "4/3")
            self.assertEqual(found["ratio"]["inheritedFrom"], "folder")
            self.assertIn("rewind", found)
            self.assertNotIn("gamescope", found)

    def test_writes_and_removes_only_valid_per_game_keys(self):
        with tempfile.TemporaryDirectory() as temp:
            manifest, systems, features, conf, appid = self.fixture(Path(temp))
            patches = self.patches(manifest, systems, features, conf)
            with (
                patches[0],
                patches[1],
                patches[2],
                patches[3],
                patches[4],
                mock.patch.object(emulation, "settings_set") as setter,
                mock.patch.object(emulation, "settings_remove") as remover,
            ):
                emulation.set_game_setting(appid, "ratio", "16/9")
                emulation.set_game_setting(appid, "ratio", None)
                with self.assertRaisesRegex(ValueError, "unsupported value"):
                    emulation.set_game_setting(appid, "ratio", "21/9")

            setter.assert_called_once_with('snes["Zelda.sfc"].ratio', "16/9")
            remover.assert_called_once_with('snes["Zelda.sfc"].ratio')


class CalibrationTests(unittest.TestCase):
    @staticmethod
    def valid_capture():
        capture = {}
        for name in ("left_x", "left_y", "right_x", "right_y"):
            capture[name] = {"center": 0, "min": -900, "max": 900, "range": 2048}
        for name in ("left_trigger", "right_trigger"):
            capture[name] = {"center": 0, "min": 0, "max": 1500, "range": 1552}
        return capture

    def test_rejects_incomplete_capture(self):
        capture = self.valid_capture()
        capture["right_x"] = {"center": 0, "min": -2, "max": 3, "range": 2048}
        with self.assertRaisesRegex(ValueError, "right_x"):
            calibration.validate_capture(capture)

    def test_reset_writes_native_batocera_format_and_applies_live(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            params = root / "parameters"
            params.mkdir()
            for name in (*calibration.CALIBRATION_PARAMS, "update_params"):
                (params / name).write_text("0", encoding="utf-8")
            target = root / "rsinput-calibration.conf"
            with (
                mock.patch.object(calibration, "RSINPUT_PARAMETERS", params),
                mock.patch.object(calibration, "INPUT_CALIBRATION_CONFIG", target),
                mock.patch.object(calibration, "BATOCERA_CALIBRATION_INIT", root / "missing-init"),
                mock.patch.object(
                    calibration,
                    "controller_state",
                    return_value={"supported": True, "controls": {}, "event": {}, "canApply": True},
                ),
            ):
                state = calibration.reset_calibration_params()

            text = target.read_text(encoding="utf-8")
            self.assertIn("axis_leftx_min=-1024", text)
            self.assertIn("trigger_right_max=1552", text)
            self.assertIn("update_params=1", text)
            self.assertFalse(text.lstrip().startswith("{"))
            self.assertEqual((params / "axis_leftx_min").read_text(encoding="utf-8"), "-1024")
            self.assertEqual((params / "update_params").read_text(encoding="utf-8"), "1")
            self.assertTrue(state["saved"])


class BackPaddleTests(unittest.TestCase):
    def test_fresh_defaults_do_not_take_over_gamepad_navigation(self):
        self.assertEqual(set(paddle_actions.DEFAULT_BINDINGS.values()), {"none"})
        self.assertIn(
            ("control_center", "Batocera Control Center (host app)"),
            paddle_actions.ACTIONS,
        )

    def test_unversioned_unsafe_defaults_migrate_to_safe_m2_binding(self):
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp) / "back-paddles.json"
            config.write_text(
                json.dumps({"bindings": back_paddles.LEGACY_UNSAFE_DEFAULT_BINDINGS}),
                encoding="utf-8",
            )
            with mock.patch.object(back_paddles, "CONFIG_PATH", config):
                bindings = back_paddles.load_bindings()

        self.assertEqual(bindings["m2"], "none")

    def test_unversioned_active_defaults_migrate_to_unassigned_paddles(self):
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp) / "back-paddles.json"
            config.write_text(
                json.dumps({"bindings": back_paddles.LEGACY_UNVERSIONED_ACTIVE_DEFAULT_BINDINGS}),
                encoding="utf-8",
            )
            with mock.patch.object(back_paddles, "CONFIG_PATH", config):
                bindings = back_paddles.load_bindings()

        self.assertEqual(set(bindings.values()), {"none"})

    def test_versioned_active_bindings_are_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp) / "back-paddles.json"
            config.write_text(
                json.dumps(
                    {
                        "version": back_paddles.CONFIG_VERSION,
                        "bindings": back_paddles.LEGACY_UNVERSIONED_ACTIVE_DEFAULT_BINDINGS,
                    }
                ),
                encoding="utf-8",
            )
            with mock.patch.object(back_paddles, "CONFIG_PATH", config):
                bindings = back_paddles.load_bindings()

        self.assertEqual(bindings["m1"], "control_center")
        self.assertEqual(bindings["m1_m2"], "mangohud_toggle")

    def test_rejects_unknown_actions_and_writes_atomically(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            service = root / "batocera_control_paddles"
            service.touch()
            config = root / "back-paddles.json"
            backend = {
                "source": "rsinput",
                "device": {"name": "AYN Odin3 Gamepad", "path": "/dev/input/event2"},
                "service": service,
                "service_name": "batocera_control_paddles",
                "reason": "",
            }
            with (
                mock.patch.object(back_paddles, "CONFIG_PATH", config),
                mock.patch.object(back_paddles, "_detect_backend", return_value=backend),
                mock.patch.object(back_paddles, "_backend_running", return_value=True),
                mock.patch.object(back_paddles, "_restart_daemon"),
            ):
                with self.assertRaisesRegex(ValueError, "invalid action"):
                    back_paddles.save_state({"m1": "shell:rm -rf /"})
                self.assertFalse(config.exists())
                result = back_paddles.save_state({"m1": "screenshot", "m2": "mouse_left"})

            self.assertEqual(result["bindings"]["m1"], "screenshot")
            self.assertEqual(result["source"], "rsinput")
            self.assertEqual(stat.S_IMODE(config.stat().st_mode), 0o644)
            self.assertEqual(json.loads(config.read_text(encoding="utf-8"))["version"], 2)

    def test_detects_ayn_rsinput_by_capabilities_not_event_number(self):
        fake = mock.Mock()
        fake.name = "AYN Odin3 Gamepad"
        fake.path = "/dev/input/event11"
        fake.info.vendor = 0x2020
        fake.capabilities.return_value = {
            1: [back_paddles.RSINPUT_M1_CODE, back_paddles.RSINPUT_M2_CODE, 304]
        }
        with (
            mock.patch.object(back_paddles, "evdev") as mocked_evdev,
            mock.patch.object(back_paddles, "ecodes") as mocked_ecodes,
            mock.patch.object(back_paddles, "_input_candidates", return_value=[Path("/dev/input/event11")]),
        ):
            mocked_ecodes.EV_KEY = 1
            mocked_evdev.InputDevice.return_value = fake
            info = back_paddles.rsinput_device_info()

        self.assertEqual(info["path"], "/dev/input/event11")
        self.assertEqual(info["m1Code"], 710)
        self.assertEqual(info["m2Code"], 708)
        fake.close.assert_called_once()

    def test_detects_ayn_rsinput_from_sysfs_without_evdev(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            device = root / "event11/device"
            (device / "id").mkdir(parents=True)
            (device / "capabilities").mkdir()
            (device / "name").write_text("AYN Odin3 Gamepad\n", encoding="utf-8")
            (device / "id/vendor").write_text("2020\n", encoding="ascii")

            words = [0] * 12
            for code in back_paddles.RSINPUT_REQUIRED_CODES:
                words[code // 64] |= 1 << (code % 64)
            bitmap = " ".join(f"{word:x}" for word in reversed(words)) + "\n"
            (device / "capabilities/key").write_text(bitmap, encoding="ascii")

            with (
                mock.patch.object(back_paddles, "INPUT_SYSFS", root),
                mock.patch.object(back_paddles, "evdev", None),
                mock.patch.object(back_paddles, "ecodes", None),
                mock.patch.object(back_paddles, "_input_candidates", return_value=[Path("/dev/input/event11")]),
            ):
                info = back_paddles.rsinput_device_info()

        self.assertEqual(info["name"], "AYN Odin3 Gamepad")
        self.assertEqual(info["path"], "/dev/input/event11")
        self.assertEqual(info["m1Code"], 710)
        self.assertEqual(info["m2Code"], 708)


class PaddleInterpreterTests(unittest.TestCase):
    def test_taps_fire_on_release(self):
        fired = []
        interpreter = paddle_daemon.PaddleInterpreter(fired.append)
        interpreter.handle(back_paddles.RSINPUT_M1_CODE, 1)
        interpreter.handle(back_paddles.RSINPUT_M1_CODE, 0)
        interpreter.handle(back_paddles.RSINPUT_M2_CODE, 1)
        interpreter.handle(back_paddles.RSINPUT_M2_CODE, 0)
        self.assertEqual(fired, ["m1", "m2"])

    def test_two_paddle_chord_fires_once_and_suppresses_taps(self):
        fired = []
        interpreter = paddle_daemon.PaddleInterpreter(fired.append)
        interpreter.handle(back_paddles.RSINPUT_M1_CODE, 1)
        interpreter.handle(back_paddles.RSINPUT_M2_CODE, 1)
        interpreter.handle(back_paddles.RSINPUT_M1_CODE, 0)
        interpreter.handle(back_paddles.RSINPUT_M2_CODE, 0)
        self.assertEqual(fired, ["m1_m2"])

    def test_home_hotkey_chords_do_not_double_fire_tap_actions(self):
        fired = []
        interpreter = paddle_daemon.PaddleInterpreter(fired.append)
        interpreter.handle(paddle_daemon.BTN_HOME, 1)
        interpreter.handle(back_paddles.RSINPUT_M1_CODE, 1)
        interpreter.handle(back_paddles.RSINPUT_M1_CODE, 0)
        interpreter.handle(paddle_daemon.BTN_HOME, 0)
        self.assertEqual(fired, [])

        interpreter.handle(back_paddles.RSINPUT_M2_CODE, 1)
        interpreter.handle(paddle_daemon.BTN_HOME, 1)
        interpreter.handle(paddle_daemon.BTN_HOME, 0)
        interpreter.handle(back_paddles.RSINPUT_M2_CODE, 0)
        self.assertEqual(fired, ["home_m2"])


class PaddleActionTests(unittest.TestCase):
    def test_batocera_wifi_and_bluetooth_toggle_both_directions(self):
        commands = []

        def setting(key):
            return {"wifi.enabled": "0", "controllers.bluetooth.enabled": "1"}.get(key, "")

        with (
            mock.patch.object(paddle_actions, "_settings_get", side_effect=setting),
            mock.patch.object(paddle_actions, "_run", side_effect=lambda command: commands.append(command) or ""),
            mock.patch("pathlib.Path.exists", return_value=False),
        ):
            paddle_actions.run_action("wifi_toggle")
            paddle_actions.run_action("bluetooth_toggle")

        self.assertIn(["batocera-wifi", "enable"], commands)
        self.assertIn(["batocera-bluetooth", "disable"], commands)

    def test_corrupt_saved_brightness_does_not_crash(self):
        with tempfile.TemporaryDirectory() as temp:
            saved = Path(temp) / "brightness"
            saved.write_text("not-a-number", encoding="utf-8")
            commands = []
            with (
                mock.patch.object(paddle_actions, "BRIGHTNESS_STATE", saved),
                mock.patch.object(paddle_actions, "_run", side_effect=lambda command: commands.append(command) or "70"),
            ):
                paddle_actions.run_action("brightness_min_toggle")
            self.assertIn(["batocera-brightness", "70"], commands)
            self.assertFalse(saved.exists())

    def test_mangohud_uses_stock_mangohudctl(self):
        commands = []
        with tempfile.TemporaryDirectory() as temp:
            ctl = Path(temp) / "mangohudctl"
            ctl.write_text("#!/bin/sh\n", encoding="utf-8")
            with (
                mock.patch.object(paddle_actions, "MANGOHUDCTL", ctl),
                mock.patch.object(paddle_actions, "_run", side_effect=lambda command: commands.append(command) or ""),
            ):
                paddle_actions.run_action("mangohud_toggle")
                info = paddle_actions.resolve_action("mangohud_toggle")
        self.assertEqual(commands, [[str(ctl), "toggle", "no_display"]])
        self.assertTrue(info["available"])
        self.assertEqual(info["backend"], "mangohudctl")

    def test_keys_do_not_call_userdata_odin_key_send(self):
        commands = []
        with (
            mock.patch.object(paddle_actions, "_run", side_effect=lambda command: commands.append(command) or ""),
            mock.patch.object(paddle_actions, "_uinput_ready", return_value=False),
        ):
            paddle_actions.run_action("key_f1")
        self.assertEqual(commands, [])
        self.assertTrue(all("/userdata/system/scripts" not in " ".join(cmd) for cmd in commands))

    def test_power_profile_cycle_falls_back_to_cpu_governor(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cpu0 = root / "cpu0" / "cpufreq"
            cpu0.mkdir(parents=True)
            (cpu0 / "scaling_available_governors").write_text("ondemand powersave performance\n", encoding="utf-8")
            (cpu0 / "scaling_governor").write_text("ondemand\n", encoding="utf-8")
            state = root / "governor-state"
            missing_odin = root / "missing-odin-power"
            commands = []
            with (
                mock.patch.object(paddle_actions, "ODIN_POWER", missing_odin),
                mock.patch.object(paddle_actions, "CPUFREQ_ROOT", root),
                mock.patch.object(paddle_actions, "GOVERNOR_STATE", state),
                mock.patch.object(paddle_actions, "_run", side_effect=lambda command: commands.append(command) or ""),
            ):
                paddle_actions.run_action("power_profile_cycle")
                info = paddle_actions.resolve_action("power_profile_cycle")
            self.assertEqual(commands, [])
            self.assertEqual(state.read_text(encoding="utf-8"), "performance")
            self.assertEqual((cpu0 / "scaling_governor").read_text(encoding="utf-8").strip(), "performance")
            self.assertTrue(info["available"])
            self.assertEqual(info["backend"], "cpufreq-governor")

    def test_every_named_action_has_a_resolver(self):
        for key, _label in paddle_actions.ACTIONS:
            info = paddle_actions.resolve_action(key)
            self.assertEqual(info["action"], key)
            self.assertNotEqual(info["backend"], "unimplemented")

    def test_fan_cycle_prefers_qcom_fan(self):
        commands = []
        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp) / "fan"
            qcom = Path(temp) / "qcom-fan"
            qcom.write_text("#!/bin/sh\n", encoding="utf-8")
            with (
                mock.patch.object(paddle_actions, "QCOM_FAN", qcom),
                mock.patch.object(paddle_actions, "FAN_MODE_STATE", state),
                mock.patch.object(paddle_actions, "_run", side_effect=lambda command: commands.append(command) or ""),
            ):
                paddle_actions.run_action("fan_mode_cycle")
            self.assertEqual(commands[0][0], str(qcom))
            self.assertIn(commands[0][1], {"silent", "auto", "aggressive", "set", "stop"})


class PersistentRuntimeTests(unittest.TestCase):
    def test_arm_host_survives_fex_x86_personality(self):
        with (
            mock.patch.object(runtime.platform, "machine", return_value="x86_64"),
            mock.patch.object(runtime.Path, "read_bytes", return_value=b"qcom,sm8550 ayn,thor"),
        ):
            self.assertTrue(runtime._arm_host())

    def test_installs_versioned_helper_to_stable_userdata_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            wrapper = root / "scripts" / "batocera-control-game-launch"
            contract = root / "config" / "fex-profiles.json"
            with (
                mock.patch.object(runtime, "STABLE_WRAPPER", wrapper),
                mock.patch.object(runtime, "STABLE_FEX_CONTRACT", contract),
                mock.patch.object(runtime, "_arm_host", return_value=True),
            ):
                state = runtime.ensure_runtime()
                second = runtime.ensure_runtime()
            self.assertTrue(state["supported"])
            self.assertTrue(second["supported"])
            self.assertEqual(stat.S_IMODE(wrapper.stat().st_mode), 0o755)
            self.assertIn("default", json.loads(contract.read_text(encoding="utf-8"))["profiles"])

    def test_x86_does_not_offer_or_install_fex_wrapper(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            wrapper = root / "bin" / "batocera-control-game-launch"
            contract = root / "config" / "fex-profiles.json"
            with (
                mock.patch.object(runtime, "STABLE_WRAPPER", wrapper),
                mock.patch.object(runtime, "STABLE_FEX_CONTRACT", contract),
                mock.patch.object(runtime, "_arm_host", return_value=False),
            ):
                state = runtime.ensure_runtime()

            self.assertFalse(state["supported"])
            self.assertEqual(state["path"], "")
            self.assertIn("ARM64", state["reason"])
            self.assertFalse(wrapper.exists())
            self.assertFalse(contract.exists())

    def test_launch_helper_fails_open_when_fex_config_is_missing(self):
        helper = PLUGIN_ROOT / "py_modules" / "batocera-control-game-launch"
        result = subprocess.run(
            [sys.executable, str(helper), "/bin/echo", "game-started"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
            env={**os.environ, "STEAM_COMPAT_APP_ID": "1234"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "game-started")


class PowerDetectionTests(unittest.TestCase):
    def test_generic_amd_tool_does_not_mislabel_arm_host(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            amd_tdp = root / "batocera-amd-tdp"
            device_tree = root / "compatible"
            amd_tdp.touch()
            device_tree.touch()
            with (
                mock.patch.object(power, "POWER_SCRIPT", root / "missing-odin-power"),
                mock.patch.object(power, "AMD_TDP", amd_tdp),
                mock.patch.object(power, "DEVICE_TREE_COMPAT", device_tree),
                mock.patch.object(power, "SIMPLE_DECKY_TDP", root / "missing-plugin"),
            ):
                self.assertIn("odin-power", power.unsupported_reason())
                self.assertIn("Adaptive CPU", power.unsupported_reason())

    def test_x86_defers_to_simple_decky_tdp(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            amd_tdp = root / "batocera-amd-tdp"
            plugin = root / "SimpleDeckyTDP" / "plugin.json"
            amd_tdp.touch()
            plugin.parent.mkdir()
            plugin.touch()
            with (
                mock.patch.object(power, "POWER_SCRIPT", root / "missing-odin-power"),
                mock.patch.object(power, "AMD_TDP", amd_tdp),
                mock.patch.object(power, "DEVICE_TREE_COMPAT", root / "missing-device-tree"),
                mock.patch.object(power, "SIMPLE_DECKY_TDP", plugin),
            ):
                self.assertIn("SimpleDeckyTDP", power.unsupported_reason())


class CpuLimitTests(unittest.TestCase):
    @staticmethod
    def status(mode="adaptive"):
        return {
            "available": True,
            "mode": mode,
            "global_cap": "85",
            "global_target_fps": "60",
            "running": mode != "off",
            "temp": 64.5,
            "fan_percent": 40,
            "fps": 59.8,
            "session": {
                "cap": "auto",
                "fps_path": cpu_limit.GAMESCOPE_STATS,
                "target_fps": "auto",
            },
        }

    def test_reports_native_limiter_and_distinguishes_gamescope_sampler(self):
        with tempfile.TemporaryDirectory() as temp:
            helper = Path(temp) / "batocera-cpu-limit"
            helper.touch()
            result = subprocess.CompletedProcess([], 0, json.dumps(self.status()), "")
            with (
                mock.patch.object(cpu_limit, "HELPER", helper),
                mock.patch.object(cpu_limit, "_result", return_value=result),
            ):
                state = cpu_limit.get_state()

        self.assertTrue(state["supported"])
        self.assertEqual(state["mode"], "adaptive")
        self.assertEqual(state["globalCap"], "85")
        self.assertEqual(state["fps"], 59.8)
        self.assertEqual(state["dataSource"], "Steam / Gamescope stats")

    def test_batches_persistent_values_and_applies_native_daemon_once(self):
        with tempfile.TemporaryDirectory() as temp:
            helper = Path(temp) / "batocera-cpu-limit"
            helper.touch()
            calls = []

            def command(args, timeout=10):
                calls.append((args, timeout))
                if args == ["apply-mode"]:
                    return subprocess.CompletedProcess(args, 0, "", "")
                if args == ["status"]:
                    return subprocess.CompletedProcess(args, 0, json.dumps(self.status()), "")
                raise AssertionError(args)

            with (
                mock.patch.object(cpu_limit, "HELPER", helper),
                mock.patch.object(cpu_limit, "_result", side_effect=command),
                mock.patch.object(cpu_limit, "settings_set_many") as settings,
            ):
                saved = cpu_limit.save_state(
                    {"mode": "adaptive", "globalCap": "85", "globalTargetFps": "60"}
                )

            settings.assert_called_once_with(
                [
                    (cpu_limit.MODE_SETTING, "adaptive"),
                    (cpu_limit.GLOBAL_CAP_SETTING, "85"),
                    (cpu_limit.GLOBAL_TARGET_SETTING, "60"),
                ]
            )
            self.assertEqual([call[0] for call in calls].count(["apply-mode"]), 1)
            self.assertTrue(saved["running"])

    def test_rejects_unadvertised_values_before_writing(self):
        with tempfile.TemporaryDirectory() as temp:
            helper = Path(temp) / "batocera-cpu-limit"
            helper.touch()
            with (
                mock.patch.object(cpu_limit, "HELPER", helper),
                mock.patch.object(cpu_limit, "settings_set_many") as settings,
            ):
                with self.assertRaisesRegex(ValueError, "mode"):
                    cpu_limit.save_state(
                        {"mode": "turbo", "globalCap": "85", "globalTargetFps": "60"}
                    )
            settings.assert_not_called()

    @staticmethod
    def tdp_status(mode="adaptive"):
        return {
            "available": True,
            "saved_mode": mode,
            "active_mode": mode,
            "saved_target": "60",
            "current_tdp": 14,
            "daemon_running": mode == "adaptive",
            "base_tdp": 18,
            "min_tdp": 7,
            "max_tdp": 18,
            "hardware_min": 7,
            "hardware_max": 30,
            "fps_source": cpu_limit.TDP_GAMESCOPE_STATS,
        }

    def test_reports_native_x86_tdp_limiter_and_fresh_fps(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            tdp_helper = root / "batocera-tdp-limit"
            tdp_helper.touch()
            fps_state = root / "fps.json"
            fps_state.write_text(
                json.dumps({"fps": 59.7, "timestamp": time.time()}),
                encoding="utf-8",
            )
            result = subprocess.CompletedProcess([], 0, json.dumps(self.tdp_status()), "")
            with (
                mock.patch.object(cpu_limit, "HELPER", root / "missing-cpu-limit"),
                mock.patch.object(cpu_limit, "TDP_HELPER", tdp_helper),
                mock.patch.object(cpu_limit, "TDP_FPS_STATE", fps_state),
                mock.patch.object(cpu_limit, "_tdp_result", return_value=result),
            ):
                state = cpu_limit.get_state()

        self.assertTrue(state["supported"])
        self.assertEqual(state["kind"], "tdp")
        self.assertEqual(state["currentTdp"], 14)
        self.assertEqual(state["minTdp"], 7)
        self.assertEqual(state["maxTdp"], 18)
        self.assertEqual(state["fps"], 59.7)
        self.assertEqual(state["dataSource"], "Steam / Gamescope stats")
        self.assertEqual(state["capOptions"], [])

    def test_tdp_settings_apply_adaptive_and_stop_off_session(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            tdp_helper = root / "batocera-tdp-limit"
            tdp_helper.touch()
            calls = []
            current_mode = "adaptive"

            def command(args, timeout=10):
                nonlocal current_mode
                calls.append((args, timeout))
                if args == ["apply-mode"]:
                    current_mode = "adaptive"
                    return subprocess.CompletedProcess(args, 0, "", "")
                if args == ["game-stop"]:
                    current_mode = "off"
                    return subprocess.CompletedProcess(args, 0, "", "")
                if args == ["json"]:
                    return subprocess.CompletedProcess(args, 0, json.dumps(self.tdp_status(current_mode)), "")
                raise AssertionError(args)

            with (
                mock.patch.object(cpu_limit, "HELPER", root / "missing-cpu-limit"),
                mock.patch.object(cpu_limit, "TDP_HELPER", tdp_helper),
                mock.patch.object(cpu_limit, "_tdp_result", side_effect=command),
                mock.patch.object(cpu_limit, "settings_set_many") as settings,
            ):
                adaptive = cpu_limit.save_state(
                    {"mode": "adaptive", "globalCap": "auto", "globalTargetFps": "60"}
                )
                stopped = cpu_limit.save_state(
                    {"mode": "off", "globalCap": "auto", "globalTargetFps": "60"}
                )

        self.assertTrue(adaptive["running"])
        self.assertFalse(stopped["running"])
        self.assertIn((["apply-mode"], 20), calls)
        self.assertIn((["game-stop"], 20), calls)
        self.assertEqual(
            settings.call_args_list,
            [
                mock.call([(cpu_limit.TDP_MODE_SETTING, "adaptive"), (cpu_limit.TDP_TARGET_SETTING, "60")]),
                mock.call([(cpu_limit.TDP_MODE_SETTING, "off"), (cpu_limit.TDP_TARGET_SETTING, "60")]),
            ],
        )


class FanControlTests(unittest.TestCase):
    @staticmethod
    def status(mode="auto", target=None):
        return {
            "available": True,
            "control": True,
            "name": "qcom-fan",
            "rpm": 4200,
            "percent": 40,
            "mode": mode,
            "target_percent": target,
        }

    def test_manual_uses_same_native_set_command_as_control_center(self):
        with tempfile.TemporaryDirectory() as temp:
            helper = Path(temp) / "qcom-fan"
            helper.touch()
            calls = []

            def command(args, timeout=10):
                calls.append((args, timeout))
                if args == ["json"]:
                    status = self.status("manual", 55) if ["set", "55"] in [item[0] for item in calls] else self.status()
                    return subprocess.CompletedProcess(args, 0, json.dumps(status), "")
                if args == ["set", "55"]:
                    return subprocess.CompletedProcess(args, 0, "55\n", "")
                raise AssertionError(args)

            with (
                mock.patch.object(fan_control, "HELPER", helper),
                mock.patch.object(fan_control, "_result", side_effect=command),
            ):
                state = fan_control.save_state({"mode": "manual", "targetPercent": 55})

        self.assertIn((["set", "55"], 20), calls)
        self.assertEqual(state["mode"], "manual")
        self.assertEqual(state["targetPercent"], 55)

    def test_auto_restores_temperature_curve(self):
        with tempfile.TemporaryDirectory() as temp:
            helper = Path(temp) / "qcom-fan"
            helper.touch()
            calls = []

            def command(args, timeout=10):
                calls.append(args)
                if args == ["json"]:
                    return subprocess.CompletedProcess(args, 0, json.dumps(self.status()), "")
                if args == ["auto"]:
                    return subprocess.CompletedProcess(args, 0, "", "")
                raise AssertionError(args)

            with (
                mock.patch.object(fan_control, "HELPER", helper),
                mock.patch.object(fan_control, "_result", side_effect=command),
            ):
                fan_control.save_state({"mode": "auto", "targetPercent": 40})

        self.assertEqual(calls.count(["auto"]), 1)

    def test_aggressive_uses_named_qcom_curve(self):
        with tempfile.TemporaryDirectory() as temp:
            helper = Path(temp) / "qcom-fan"
            helper.touch()
            calls = []

            def command(args, timeout=10):
                calls.append(args)
                if args == ["json"]:
                    return subprocess.CompletedProcess(args, 0, json.dumps(self.status("aggressive")), "")
                if args == ["aggressive"]:
                    return subprocess.CompletedProcess(args, 0, "", "")
                raise AssertionError(args)

            with (
                mock.patch.object(fan_control, "HELPER", helper),
                mock.patch.object(fan_control, "_result", side_effect=command),
            ):
                state = fan_control.save_state({"mode": "aggressive", "targetPercent": 40})

        self.assertEqual(calls.count(["aggressive"]), 1)
        self.assertEqual(state["mode"], "aggressive")
        self.assertTrue(any(option["data"] == "silent" for option in state["modes"]))

    def test_off_stops_fan_daemon(self):
        with tempfile.TemporaryDirectory() as temp:
            helper = Path(temp) / "qcom-fan"
            helper.touch()
            calls = []

            def command(args, timeout=10):
                calls.append(args)
                if args == ["json"]:
                    return subprocess.CompletedProcess(args, 0, json.dumps(self.status("off")), "")
                if args == ["stop"]:
                    return subprocess.CompletedProcess(args, 0, "", "")
                raise AssertionError(args)

            with (
                mock.patch.object(fan_control, "HELPER", helper),
                mock.patch.object(fan_control, "_result", side_effect=command),
            ):
                state = fan_control.save_state({"mode": "off", "targetPercent": 40})

        self.assertEqual(calls.count(["stop"]), 1)
        self.assertEqual(state["mode"], "off")


class LsfgTests(unittest.TestCase):
    def test_uses_system_layers_and_persists_steam_scope(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            native_lib = root / "usr/lib/liblsfg-vk.so"
            native_layer = root / "usr/share/vulkan/explicit_layer.d/VkLayer_LS_frame_generation.json"
            dll = root / "userdata/system/wine/lossless-scaling/Lossless.dll"
            bundled_wrapper = root / "bundled-lsfg-launch"
            stable_wrapper = root / "userdata/system/bin/batocera-control-lsfg-launch"
            runtime_config = root / "userdata/system/configs/batocera-control/lsfg.json"
            runtime_env = root / "userdata/system/configs/batocera-control/lsfg.env"
            for path in (native_lib, native_layer, dll):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            bundled_wrapper.write_text("#!/bin/bash\n# BATOCERA_CONTROL_LSFG_LAUNCH\n", encoding="utf-8")
            store = {}
            writes = []

            def command(args, **_kwargs):
                if args[0] == lsfg.SETTINGS_GET:
                    return subprocess.CompletedProcess(args, 0, store.get(args[1], ""), "")
                raise AssertionError(args)

            def set_many(pairs):
                flat = []
                for key, value in pairs:
                    flat.extend((key, value))
                    store[key] = value
                writes.append(flat)

            with (
                mock.patch.object(lsfg, "DEFAULT_DLL", dll),
                mock.patch.object(lsfg, "NATIVE_LIBRARY", native_lib),
                mock.patch.object(lsfg, "NATIVE_LAYER", native_layer),
                mock.patch.object(lsfg, "WINE_LIBRARY", root / "missing-x64-lib"),
                mock.patch.object(lsfg, "WINE_LAYER", root / "missing-x64-layer"),
                mock.patch.object(lsfg, "LEGACY_PLUGIN", root / "missing-plugin"),
                mock.patch.object(lsfg, "LEGACY_CONFIG", root / "missing-config"),
                mock.patch.object(lsfg, "LEGACY_SCRIPTS", (root / "missing-script",)),
                mock.patch.object(lsfg, "BUNDLED_WRAPPER", bundled_wrapper),
                mock.patch.object(lsfg, "STABLE_WRAPPER", stable_wrapper),
                mock.patch.object(lsfg, "RUNTIME_CONFIG", runtime_config),
                mock.patch.object(lsfg, "RUNTIME_ENV", runtime_env),
                mock.patch.object(lsfg.platform, "machine", return_value="aarch64"),
                mock.patch.object(lsfg, "run_cmd", side_effect=command),
                mock.patch.object(lsfg, "settings_set_many", side_effect=set_many),
            ):
                initial = lsfg.get_state()
                saved = lsfg.save_state(
                    {
                        "enabled": True,
                        "multiplier": "3",
                        "flowScale": "0.5",
                        "performanceMode": True,
                        "hdrMode": False,
                        "presentMode": "mailbox",
                    }
                )
                per_game = lsfg.set_game_enabled("12345", True)

            self.assertTrue(initial["ready"])
            self.assertEqual(initial["config"]["flowScale"], "0.75")
            self.assertEqual(store["steam.lsfg_vk"], "1")
            self.assertEqual(store["steam.lsfg_vk_dll"], str(dll))
            self.assertEqual(store["steam.lsfg_vk_multiplier"], "3")
            self.assertEqual(store["steam.lsfg_vk_flow_scale"], "0.5")
            self.assertEqual(store["steam.lsfg_vk_present_mode"], "mailbox")
            self.assertEqual(len(writes), 1)
            self.assertEqual(writes[0][-2:], ["steam.lsfg_vk", "1"])
            self.assertTrue(saved["config"]["enabled"])
            self.assertEqual(per_game["enabledAppids"], ["12345"])
            self.assertTrue(per_game["perGameSupported"])
            self.assertTrue(stable_wrapper.stat().st_mode & stat.S_IXUSR)
            self.assertEqual(stat.S_IMODE(runtime_env.stat().st_mode), 0o644)
            self.assertIn("BATOCERA_LSFG_ENABLED_APPIDS=12345", runtime_env.read_text(encoding="utf-8"))
            self.assertEqual(json.loads(runtime_config.read_text(encoding="utf-8"))["enabledAppids"], ["12345"])
            self.assertNotIn("download", " ".join(store))

    def test_refuses_enable_without_purchased_dll(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            native_lib = root / "liblsfg-vk.so"
            native_layer = root / "VkLayer_LS_frame_generation.json"
            bundled_wrapper = root / "bundled-lsfg-launch"
            stable_wrapper = root / "stable-lsfg-launch"
            runtime_config = root / "lsfg.json"
            runtime_env = root / "lsfg.env"
            native_lib.touch()
            native_layer.touch()
            bundled_wrapper.write_text("#!/bin/bash\n# BATOCERA_CONTROL_LSFG_LAUNCH\n", encoding="utf-8")

            def command(args, **_kwargs):
                return subprocess.CompletedProcess(args, 0, "", "")

            with (
                mock.patch.object(lsfg, "DEFAULT_DLL", root / "missing-Lossless.dll"),
                mock.patch.object(lsfg, "NATIVE_LIBRARY", native_lib),
                mock.patch.object(lsfg, "NATIVE_LAYER", native_layer),
                mock.patch.object(lsfg, "WINE_LIBRARY", root / "missing-x64-lib"),
                mock.patch.object(lsfg, "WINE_LAYER", root / "missing-x64-layer"),
                mock.patch.object(lsfg, "LEGACY_PLUGIN", root / "missing-plugin"),
                mock.patch.object(lsfg, "LEGACY_CONFIG", root / "missing-config"),
                mock.patch.object(lsfg, "LEGACY_SCRIPTS", (root / "missing-script",)),
                mock.patch.object(lsfg, "BUNDLED_WRAPPER", bundled_wrapper),
                mock.patch.object(lsfg, "STABLE_WRAPPER", stable_wrapper),
                mock.patch.object(lsfg, "RUNTIME_CONFIG", runtime_config),
                mock.patch.object(lsfg, "RUNTIME_ENV", runtime_env),
                mock.patch.object(lsfg, "run_cmd", side_effect=command),
            ):
                with self.assertRaisesRegex(RuntimeError, "Lossless.dll"):
                    lsfg.save_state({"enabled": True, "multiplier": "2", "flowScale": "0.75"})
                with self.assertRaisesRegex(ValueError, "boolean"):
                    lsfg.save_state({"enabled": "true", "multiplier": "2", "flowScale": "0.75"})

    def test_per_game_wrapper_activates_only_listed_appid(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            layer_root = root / "layer"
            dll = root / "Lossless.dll"
            layer_library = layer_root / "lib/liblsfg-vk.so"
            layer_manifest = layer_root / "share/vulkan/explicit_layer.d/VkLayer_LS_frame_generation.json"
            for path in (dll, layer_library, layer_manifest):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            env_file = root / "lsfg.env"
            env_file.write_text(
                "\n".join(
                    (
                        "BATOCERA_LSFG_ENABLED_APPIDS='123 456'",
                        f"BATOCERA_LSFG_LAYER_ROOT='{layer_root}'",
                        "BATOCERA_LSFG_PRESENT_MODE='mailbox'",
                        f"LSFG_DLL_PATH='{dll}'",
                        "LSFG_MULTIPLIER='2'",
                        "LSFG_FLOW_SCALE='0.75'",
                        "LSFG_PERFORMANCE_MODE='1'",
                        "LSFG_HDR_MODE='0'",
                        "",
                    )
                ),
                encoding="utf-8",
            )
            wrapper = PLUGIN_ROOT / "py_modules" / "batocera-control-lsfg-launch"
            enabled = subprocess.run(
                [str(wrapper), "--appid", "123", "/usr/bin/env"],
                check=False,
                capture_output=True,
                text=True,
                env={**os.environ, "BATOCERA_CONTROL_LSFG_CONFIG": str(env_file)},
            )
            disabled = subprocess.run(
                [str(wrapper), "--appid", "999", "/usr/bin/env"],
                check=False,
                capture_output=True,
                text=True,
                env={**os.environ, "BATOCERA_CONTROL_LSFG_CONFIG": str(env_file)},
            )

            self.assertEqual(enabled.returncode, 0, enabled.stderr)
            self.assertIn("ENABLE_LSFG=1", enabled.stdout)
            self.assertNotIn("LSFG_PROCESS=", enabled.stdout)
            self.assertIn("VK_LAYER_LS_frame_generation", enabled.stdout)
            self.assertNotIn("ENABLE_LSFG=1", disabled.stdout)


if __name__ == "__main__":
    unittest.main()
