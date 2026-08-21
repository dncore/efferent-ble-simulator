#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BLE Simulator — System Setup Script
#
# Configures the Linux system to allow a non-root user to run the BLE
# peripheral simulator via BlueZ D-Bus. Must be run once per machine with sudo.
#
# Usage:
#   sudo npm run setup
#   sudo bash scripts/setup.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[setup]${NC} $*"; }
success() { echo -e "${GREEN}[setup]${NC} $*"; }
warn()    { echo -e "${YELLOW}[setup]${NC} $*"; }
error()   { echo -e "${RED}[setup]${NC} $*" >&2; }

# ── Root check ─────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  error "This script must be run as root (sudo npm run setup)"
  exit 1
fi

# ── Detect the real invoking user (for group/permission operations) ────────────
REAL_USER="${SUDO_USER:-${USER}}"
info "Configuring system for user: ${REAL_USER}"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Check BlueZ is installed
# ─────────────────────────────────────────────────────────────────────────────
info "Checking BlueZ installation..."

if ! command -v bluetoothctl &>/dev/null; then
  warn "bluetoothctl not found — attempting to install BlueZ..."
  if command -v apt-get &>/dev/null; then
    apt-get update -qq && apt-get install -y --no-install-recommends bluetooth bluez
  elif command -v pacman &>/dev/null; then
    pacman -Sy --noconfirm bluez bluez-utils
  elif command -v dnf &>/dev/null; then
    dnf install -y bluez
  elif command -v zypper &>/dev/null; then
    zypper install -y bluez
  else
    error "Cannot install BlueZ automatically. Please install 'bluez' via your package manager."
    exit 1
  fi
fi
success "BlueZ found: $(bluetoothctl --version 2>/dev/null || echo 'unknown version')"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Enable and start bluetoothd
# ─────────────────────────────────────────────────────────────────────────────
info "Ensuring bluetoothd service is running..."

if command -v systemctl &>/dev/null; then
  systemctl enable bluetooth 2>/dev/null || true
  systemctl start bluetooth 2>/dev/null || true
  if systemctl is-active --quiet bluetooth; then
    success "bluetoothd is running"
  else
    error "bluetoothd failed to start. Check: systemctl status bluetooth"
    exit 1
  fi
else
  warn "systemd not found — please ensure bluetoothd is running manually."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Check for a BLE-capable adapter
# ─────────────────────────────────────────────────────────────────────────────
info "Checking for BLE adapter..."

ADAPTER_CHECK=$(bluetoothctl show 2>/dev/null | grep -c "Powered:" || true)
if [[ "$ADAPTER_CHECK" -eq 0 ]]; then
  error "No Bluetooth adapter detected. Plug in a USB BLE adapter or enable the built-in adapter."
  exit 1
fi

# Power on the adapter if it is off
if bluetoothctl show 2>/dev/null | grep -q "Powered: no"; then
  info "Powering on Bluetooth adapter..."
  bluetoothctl power on &>/dev/null || true
fi
success "Bluetooth adapter is present and powered"

# ─────────────────────────────────────────────────────────────────────────────
# 4. Install D-Bus policy — allows non-root process to serve GATT via BlueZ
# ─────────────────────────────────────────────────────────────────────────────
POLICY_DIR="/etc/dbus-1/system.d"
POLICY_FILE="${POLICY_DIR}/ble-simulator.conf"

info "Installing D-Bus policy to ${POLICY_FILE}..."
mkdir -p "${POLICY_DIR}"

cat > "${POLICY_FILE}" << 'POLICY'
<!-- ble-simulator: allow non-root processes to act as a BLE GATT peripheral
     via BlueZ D-Bus. This lets bluetoothd call back into the simulator
     process when RegisterApplication() is invoked.
     Installed by: npm run setup  -->
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <policy context="default">
    <allow send_interface="org.bluez.GattService1"/>
    <allow send_interface="org.bluez.GattCharacteristic1"/>
    <allow send_interface="org.bluez.GattDescriptor1"/>
    <allow send_interface="org.bluez.LEAdvertisement1"/>
    <allow send_interface="org.freedesktop.DBus.ObjectManager"/>
    <allow send_interface="org.freedesktop.DBus.Properties"/>
  </policy>
</busconfig>
POLICY

chmod 644 "${POLICY_FILE}"
success "D-Bus policy written"

# ─────────────────────────────────────────────────────────────────────────────
# 5. Reload D-Bus daemon to apply the new policy
# ─────────────────────────────────────────────────────────────────────────────
info "Reloading D-Bus daemon..."

RELOADED=false
if command -v systemctl &>/dev/null && systemctl is-active --quiet dbus 2>/dev/null; then
  # Try systemctl reload first (most distros)
  if systemctl reload dbus 2>/dev/null; then
    RELOADED=true
  fi
fi

if [[ "$RELOADED" == "false" ]]; then
  # Fall back to SIGHUP on the dbus-daemon PID
  DBUS_PID=""
  if [[ -f /run/dbus/pid ]]; then
    DBUS_PID=$(cat /run/dbus/pid)
  elif command -v pidof &>/dev/null; then
    DBUS_PID=$(pidof dbus-daemon | awk '{print $1}')
  fi

  if [[ -n "$DBUS_PID" ]]; then
    kill -HUP "$DBUS_PID" 2>/dev/null && RELOADED=true
  fi
fi

if [[ "$RELOADED" == "true" ]]; then
  success "D-Bus daemon reloaded — policy is active"
else
  warn "Could not reload D-Bus automatically."
  warn "Run 'sudo systemctl restart dbus' (or reboot) before starting the simulator."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 6. Verify the policy took effect (non-fatal sanity check)
# ─────────────────────────────────────────────────────────────────────────────
info "Verifying D-Bus policy..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"

# Locate node binary — handles nvm, fnm, volta, system installs
# 1. Try the real user's login shell (catches nvm/volta with shell integration)
NODE_BIN=$(sudo -u "${REAL_USER}" bash -lc 'command -v node' 2>/dev/null || true)
# 2. Try common system locations
if [[ -z "$NODE_BIN" ]]; then
  for _p in /usr/bin/node /usr/local/bin/node /opt/node/bin/node; do
    [[ -x "$_p" ]] && NODE_BIN="$_p" && break
  done
fi
# 3. Search fnm/nvm/volta installation dirs under the real user's home
if [[ -z "$NODE_BIN" ]]; then
  REAL_HOME=$(getent passwd "${REAL_USER}" | cut -d: -f6)
  NODE_BIN=$(find "${REAL_HOME}/.local/share/fnm" \
                  "${REAL_HOME}/.nvm" \
                  "${REAL_HOME}/.volta" \
                  -name "node" -type f -perm /111 2>/dev/null \
             | sort -V | tail -1 || true)
fi

# Run verify as the real (non-root) user so D-Bus policy is exercised correctly
if [[ -n "$NODE_BIN" ]] && [[ -d "${PROJECT_DIR}/node_modules/dbus-next" ]]; then
  # Write verify script inside the project directory so require() can resolve node_modules
  VERIFY_TMP="${PROJECT_DIR}/.ble-verify-$$.js"
  cat > "${VERIFY_TMP}" << 'JSEOF'
const dbus = require('dbus-next');
const { interface: di, Variant } = dbus;
const { Interface } = di;

class OM extends Interface {
  constructor() { super('org.freedesktop.DBus.ObjectManager'); }
  GetManagedObjects() {
    return {
      '/org/ble_setup_test/s0': {
        'org.bluez.GattService1': {
          UUID: new Variant('s','180d'),
          Primary: new Variant('b',true),
          Includes: new Variant('ao',[]),
        }
      },
      '/org/ble_setup_test/s0/c0': {
        'org.bluez.GattCharacteristic1': {
          UUID: new Variant('s','2a37'),
          Service: new Variant('o','/org/ble_setup_test/s0'),
          Flags: new Variant('as',['notify']),
          Value: new Variant('ay', Buffer.from([0])),
          Notifying: new Variant('b', false),
        }
      }
    };
  }
}
OM.configureMembers({ methods:{ GetManagedObjects:{ outSignature:'a{oa{sa{sv}}}' } } });

(async () => {
  const bus = dbus.systemBus();
  bus.on('error', () => {});
  const om = new OM();
  bus.export('/org/ble_setup_test', om);
  await new Promise(r => setTimeout(r, 400));
  try {
    const adapterObj = await bus.getProxyObject('org.bluez', '/org/bluez/hci0');
    const gm = adapterObj.getInterface('org.bluez.GattManager1');
    await gm.RegisterApplication('/org/ble_setup_test', {});
    console.log('ok');
  } catch(e) {
    console.log('fail:' + (e.message || e));
  } finally {
    bus.disconnect();
  }
})();
JSEOF

  VERIFY_RESULT=$(cd "${PROJECT_DIR}" && sudo -u "${REAL_USER}" "${NODE_BIN}" "${VERIFY_TMP}" 2>/dev/null || echo "skip")
  rm -f "${VERIFY_TMP}"

  if [[ "$VERIFY_RESULT" == "ok" ]]; then
    success "GATT registration test passed — policy is working correctly"
  elif [[ "$VERIFY_RESULT" == skip* ]] || [[ -z "$VERIFY_RESULT" ]]; then
    warn "Could not run verification. Run 'npm install && npm run setup' again after installing dependencies."
  else
    warn "GATT registration test returned: ${VERIFY_RESULT}"
    warn "If you see permission errors, try: sudo systemctl restart dbus && sudo systemctl restart bluetooth"
  fi
else
  warn "Skipping live verification (run 'npm install' first, then 'npm run setup' again to verify)."
fi

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────
echo ""
success "Setup complete! Next steps:"
echo "  npm install       # install Node dependencies (if not done)"
echo "  npm run build     # compile TypeScript"
echo "  npm start         # start MCP service (no sudo needed)"
