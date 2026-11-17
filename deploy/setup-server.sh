#!/usr/bin/env bash
# Run ONCE as root on a fresh Ubuntu 24.04 server:  bash setup-server.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
[ -s /root/.ssh/authorized_keys ] || { echo "Add your SSH key first (ssh-copy-id root@SERVER_IP) - otherwise password login would be disabled and you would be locked out."; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get -y upgrade
apt-get -y install ca-certificates curl git ufw fail2ban unattended-upgrades cron
if ! swapon --show | grep -q .; then   # 2 GB swap as a safety net
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
id deploy &>/dev/null || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh && cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades
echo "Done. Open a NEW terminal and test:  ssh deploy@SERVER_IP   (keep this one open until it works)"
