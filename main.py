import asyncio

from armada_control.back_paddles import save_state as save_back_paddles
from armada_control.calibration import (
    begin_session,
    controller_state,
    end_session,
    reset_calibration_params,
    save_calibration,
)
from armada_control.config import build_config
from armada_control.controller import set_controller_type
from armada_control.cpu_limit import get_state as cpu_limit_state
from armada_control.cpu_limit import save_state as save_cpu_limit
from armada_control.emulation import get_state as emulation_state
from armada_control.emulation import managed_appids as emulation_managed_appids
from armada_control.emulation import set_game_setting as set_emulation_game_setting
from armada_control.fan_control import get_state as fan_control_state
from armada_control.fan_control import save_state as save_fan_control
from armada_control.fan_curves import get_current_temp
from armada_control.fan_curves import get_state as get_fans_state
from armada_control.fan_curves import save_all as save_fan_curves
from armada_control.joystick_led import save_state as save_joystick_led
from armada_control.lsfg import save_state as save_lsfg
from armada_control.lsfg import set_game_enabled as set_lsfg_game_enabled
from armada_control.oled_care import restart_service as restart_oled_care
from armada_control.oled_care import run_refresh_now as run_oled_refresh
from armada_control.oled_care import save_state as save_oled_care
from armada_control.power import save_power_config
from armada_control.steam import installed_games
from armada_control.tweaks import load_compat_applied, load_tweaks, save_compat_applied, save_tweaks


class Plugin:
    async def get_config(self):
        return await asyncio.to_thread(build_config, False)

    async def get_installed_games(self):
        return await asyncio.to_thread(installed_games)

    async def save_power_config(self, data):
        await asyncio.to_thread(save_power_config, data)
        return await self.get_config()

    async def reapply_perf(self, appid=None):
        from armada_control.perf import reapply_from_tweaks

        return await asyncio.to_thread(reapply_from_tweaks, load_tweaks(), appid)

    async def get_cpu_limit(self):
        return await asyncio.to_thread(cpu_limit_state)

    async def save_cpu_limit(self, data):
        return await asyncio.to_thread(save_cpu_limit, data)

    async def get_fan_control(self):
        return await asyncio.to_thread(fan_control_state)

    async def save_fan_control(self, data):
        return await asyncio.to_thread(save_fan_control, data)

    async def get_fans_state(self):
        return await asyncio.to_thread(get_fans_state)

    async def save_fan_curves(self, fan_curves, fan_settings):
        return await asyncio.to_thread(save_fan_curves, fan_curves, fan_settings)

    async def get_current_temp(self):
        return await asyncio.to_thread(get_current_temp)

    async def save_tweaks(self, data):
        await asyncio.to_thread(save_tweaks, data)
        return await self.get_config()

    async def get_compat_applied(self):
        return await asyncio.to_thread(load_compat_applied)

    async def save_compat_applied(self, appids):
        return await asyncio.to_thread(save_compat_applied, appids)

    async def set_ssh_enabled(self, enabled):
        from armada_control.system import set_ssh_enabled

        return await asyncio.to_thread(set_ssh_enabled, enabled)

    async def set_sleep_mode(self, value):
        from armada_control.system import set_sleep_mode

        return await asyncio.to_thread(set_sleep_mode, value)

    async def set_cpu_governor(self, value):
        from armada_control.system import set_cpu_governor

        return await asyncio.to_thread(set_cpu_governor, value)

    async def set_controller_type(self, value):
        return await asyncio.to_thread(set_controller_type, value)

    async def get_controller_state(self):
        return await asyncio.to_thread(controller_state)

    async def save_calibration(self, capture):
        return await asyncio.to_thread(save_calibration, capture)

    async def reset_calibration(self):
        return await asyncio.to_thread(reset_calibration_params)

    async def begin_calibration_session(self, token=None):
        return await asyncio.to_thread(begin_session, token)

    async def end_calibration_session(self, token=None):
        return await asyncio.to_thread(end_session, token)

    async def save_joystick_led(self, data):
        return await asyncio.to_thread(save_joystick_led, data)

    async def save_oled_care(self, data):
        return await asyncio.to_thread(save_oled_care, data)

    async def restart_oled_care(self):
        return await asyncio.to_thread(restart_oled_care)

    async def get_oled_idle(self):
        from armada_control.oled_care import idle_snapshot
        return await asyncio.to_thread(idle_snapshot)

    async def note_oled_activity(self):
        from armada_control.oled_care import note_activity
        await asyncio.to_thread(note_activity)
        return True

    async def _unload(self):
        from armada_control.oled_care import stop_idle_watch
        await asyncio.to_thread(stop_idle_watch)

    async def run_oled_refresh(self):
        return await asyncio.to_thread(run_oled_refresh)

    async def save_back_paddles(self, data):
        return await asyncio.to_thread(save_back_paddles, data)

    async def save_lsfg(self, data):
        return await asyncio.to_thread(save_lsfg, data)

    async def set_lsfg_game_enabled(self, appid, enabled):
        return await asyncio.to_thread(set_lsfg_game_enabled, appid, enabled)

    async def get_emulation_managed_appids(self):
        return await asyncio.to_thread(emulation_managed_appids)

    async def get_emulation_state(self, appid, emulator="", core=""):
        return await asyncio.to_thread(emulation_state, appid, emulator, core)

    async def set_emulation_game_setting(self, appid, setting, value=None):
        return await asyncio.to_thread(set_emulation_game_setting, appid, setting, value)
