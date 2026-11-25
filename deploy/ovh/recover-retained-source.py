"""Resume the original source only after a handoff failed before activation."""
import json
import pathlib
import socket
import subprocess
import time

assert socket.gethostname() == 'ubuntu-s-1vcpu-512mb-10gb-fra1'
root = pathlib.Path('/root/ovh-migration/getpretty-cutover')
state = json.loads((root / 'state.json').read_text())
assert state['phase'] == 'frozen', 'Do not resume after a writable OVH handoff'
path = pathlib.Path('/etc/nginx/sites-enabled/getprrety').resolve()
path.write_bytes((root / 'nginx-original.conf').read_bytes())
subprocess.run(['nginx', '-t'], check=True)
subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
for attempt in range(50):
    with socket.socket() as listener:
        listener.settimeout(.2)
        if listener.connect_ex(('127.0.0.1', 3001)) != 0:
            break
    time.sleep(.2)
subprocess.run(['pm2', 'restart', 'server', '--update-env'], check=True, stdout=subprocess.DEVNULL)
subprocess.run(['pm2', 'save'], check=True, stdout=subprocess.DEVNULL)
for attempt in range(40):
    response = subprocess.run(['curl', '-fsS', '--max-time', '2', 'http://127.0.0.1:3001/health'], capture_output=True)
    if response.returncode == 0:
        break
    time.sleep(1)
assert response.returncode == 0
state['phase'] = 'prepared'
(root / 'state.json').write_text(json.dumps(state, indent=2))
print('Original GetPretty source restored and healthy; no OVH writes were enabled')
