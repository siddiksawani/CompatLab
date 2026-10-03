import { readFile, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { command, docker, removeContainer } from "../command.js";

export const PROXY_IMAGE =
  "ubuntu/squid:6.6-24.04_beta@sha256:8fafd41d6ddceb295d26eea9938321d825ac5351c7e46cf6a8aa5d093b8ed1ce";
export const SQUID_POLICY = `http_port 3128
acl CONNECT method CONNECT
acl registry dstdomain -n registry.npmjs.org
acl tls port 443
acl private dst 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 192.0.0.0/24 192.0.2.0/24 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4 ::/128 ::1/128 fc00::/7 fe80::/10 ::/96 ff00::/8 fec0::/10 2001:db8::/32
acl excess maxconn 8
http_access deny !CONNECT
http_access deny !tls
http_access deny !registry
http_access deny private
http_access deny excess
http_access allow registry
http_access deny all
cache deny all
cache_mem 8 MB
maximum_object_size 0 KB
access_log stdio:/dev/stdout
cache_log /dev/stderr
logfile_rotate 0
pid_filename /tmp/squid.pid
coredump_dir /tmp
request_timeout 15 seconds
connect_timeout 5 seconds
read_timeout 30 seconds
forward_timeout 30 seconds
request_header_max_size 16 KB
visible_hostname compatlab-preparation
`;

export type PreparationNetwork = {
  name: string;
  jobIp: string;
  proxyIp: string;
  dispose(): Promise<void>;
};

export async function createPreparationNetwork(
  id: string,
  directory: string,
  downloadBytes = 512 * 1024 ** 2,
): Promise<PreparationNetwork> {
  if (
    !/^[a-f0-9-]{36}$/.test(id) ||
    !Number.isSafeInteger(downloadBytes) ||
    downloadBytes < 1024 ||
    downloadBytes > 512 * 1024 ** 2
  )
    throw new TypeError("Invalid network reservation.");
  if ((await readFile("/proc/sys/net/bridge/bridge-nf-call-iptables", "utf8")).trim() !== "1")
    throw new Error("Bridge firewall enforcement must be enabled.");
  const name = `compatlab-prep-${id}`;
  const proxyName = `${name}-proxy`;
  const chain = `CL${id.replaceAll("-", "").slice(0, 20)}`;
  let networkCreated = false;
  let proxyCreated = false;
  let chainCreated = false;
  const rules: string[][] = [];
  const dispose = async () => {
    if (proxyCreated) {
      await removeContainer(proxyName);
      proxyCreated = false;
    }
    while (rules.length) {
      const rule = rules.at(-1);
      if (!rule) break;
      await command("iptables", ["-w", "-D", ...rule]);
      rules.pop();
    }
    if (chainCreated) {
      await command("iptables", ["-w", "-F", chain]);
      await command("iptables", ["-w", "-X", chain]);
      chainCreated = false;
    }
    if (networkCreated) {
      await docker(["network", "rm", name]);
      networkCreated = false;
    }
  };
  try {
    await docker([
      "network",
      "create",
      "--internal",
      "--ipv6=false",
      "--label",
      "compatlab.managed=true",
      name,
    ]);
    networkCreated = true;
    const subnet = await docker([
      "network",
      "inspect",
      name,
      "--format",
      "{{(index .IPAM.Config 0).Subnet}}",
    ]);
    const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(subnet);
    if (!match || Number(match[5]) > 24 || match.slice(1, 5).some((part) => Number(part) > 255))
      throw new Error("Unsupported private network allocation.");
    // Docker requires an explicit subnet before it accepts fixed endpoint addresses.
    await docker(["network", "rm", name]);
    networkCreated = false;
    await docker([
      "network",
      "create",
      "--internal",
      "--ipv6=false",
      "--subnet",
      subnet,
      "--label",
      "compatlab.managed=true",
      name,
    ]);
    networkCreated = true;
    const prefix = `${match[1]}.${match[2]}.${match[3]}`;
    const proxyIp = `${prefix}.2`;
    const jobIp = `${prefix}.3`;
    await command("iptables", ["-w", "-N", chain]);
    chainCreated = true;
    await command("iptables", [
      "-w",
      "-A",
      chain,
      "-s",
      proxyIp,
      "-d",
      jobIp,
      "-p",
      "tcp",
      "--sport",
      "3128",
      "-m",
      "quota",
      "--quota",
      String(downloadBytes),
      "-j",
      "ACCEPT",
    ]);
    await command("iptables", [
      "-w",
      "-A",
      chain,
      "-s",
      jobIp,
      "-d",
      proxyIp,
      "-p",
      "tcp",
      "--dport",
      "3128",
      "-j",
      "ACCEPT",
    ]);
    await command("iptables", ["-w", "-A", chain, "-j", "DROP"]);
    for (const rule of [
      ["INPUT", "-s", jobIp, "-j", "DROP"],
      ["DOCKER-USER", "-s", jobIp, "-j", chain],
      ["DOCKER-USER", "-d", jobIp, "-j", chain],
    ]) {
      await command("iptables", ["-w", "-I", ...rule]);
      rules.push(rule);
    }
    const config = join(directory, "squid.conf");
    await writeFile(config, SQUID_POLICY, { mode: 0o644, flag: "wx" });
    await docker([
      "create",
      "--name",
      proxyName,
      "--label",
      "compatlab.managed=true",
      "--pull=never",
      "--runtime=runsc",
      "--network",
      name,
      "--ip",
      proxyIp,
      "--read-only",
      "--user=13:13",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--memory=256m",
      "--memory-swap=256m",
      "--cpus=0.25",
      "--pids-limit=128",
      "--tmpfs=/tmp:rw,nosuid,nodev,size=16m",
      "--log-driver=local",
      "--log-opt=max-size=128k",
      "--log-opt=max-file=1",
      "--log-opt=compress=false",
      "--mount",
      `type=bind,src=${config},dst=/etc/squid/squid.conf,readonly`,
      "--entrypoint=/usr/sbin/squid",
      PROXY_IMAGE,
      "-N",
      "-f",
      "/etc/squid/squid.conf",
    ]);
    proxyCreated = true;
    await docker(["network", "connect", "bridge", proxyName]);
    await docker(["start", proxyName]);
    const readyDeadline = Date.now() + 5000;
    while (true) {
      try {
        await connect(proxyIp);
        break;
      } catch {
        if (Date.now() >= readyDeadline)
          throw new Error(
            `Preparation proxy did not become ready: ${await docker(["logs", "--tail", "20", proxyName])}`,
          );
        await delay(100);
      }
    }
    return { name, jobIp, proxyIp, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

function connect(host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port: 3128 });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Proxy connection timed out."));
    });
  });
}
