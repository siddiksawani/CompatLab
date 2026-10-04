#!/usr/bin/env bash
set -euo pipefail
for version in 4 6; do
  if [[ "$version" == 4 ]]; then
    ipt=iptables
    restore=iptables-restore
  else
    ipt=ip6tables
    restore=ip6tables-restore
  fi
  {
    printf '*filter\n:CLB-VM-IN - [0:0]\n:CLB-VM-OUT - [0:0]\n-F CLB-VM-IN\n-F CLB-VM-OUT\n'
    printf '%s\n' '-A CLB-VM-IN -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT' '-A CLB-VM-IN -j DROP'
    if [[ "$version" == 4 ]]; then
      printf '%s\n' '-A CLB-VM-OUT ! -s 192.168.250.10/32 -j DROP'
      for range in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 192.0.0.0/24 192.0.2.0/24 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
        printf '%s\n' "-A CLB-VM-OUT -d $range -j DROP"
      done
      printf '%s\n' '-A CLB-VM-OUT -d 95.211.43.107/32 -p udp --dport 51820 -j ACCEPT' '-A CLB-VM-OUT -p tcp -m multiport --dports 80,443 -j ACCEPT'
      for resolver in 1.1.1.1 1.0.0.1; do
        printf '%s\n' "-A CLB-VM-OUT -d $resolver -p udp --dport 53 -j ACCEPT" "-A CLB-VM-OUT -d $resolver -p tcp --dport 53 -j ACCEPT"
      done
      printf '%s\n' '-A CLB-VM-OUT -p udp --dport 123 -j ACCEPT'
    fi
    printf '%s\n' '-A CLB-VM-OUT -j DROP' 'COMMIT'
  } | "$restore" --wait 10 --noflush
  "$ipt" -w -C INPUT -i br-compatlab -j CLB-VM-IN 2>/dev/null || "$ipt" -w -I INPUT 1 -i br-compatlab -j CLB-VM-IN
  "$ipt" -w -C FORWARD -i br-compatlab -j CLB-VM-OUT 2>/dev/null || "$ipt" -w -I FORWARD 1 -i br-compatlab -j CLB-VM-OUT
  "$ipt" -w -C FORWARD -o br-compatlab -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || "$ipt" -w -I FORWARD 2 -o br-compatlab -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  "$ipt" -w -C FORWARD -o br-compatlab -j DROP 2>/dev/null || "$ipt" -w -I FORWARD 3 -o br-compatlab -j DROP
done
