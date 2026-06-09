const Docker = require('dockerode');
const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

function networkName() {
  return process.env.CUSTOMDB_NETWORK || 'customdb-network';
}

async function ensureNetwork() {
  const name = networkName();
  const nets = await docker.listNetworks({ filters: JSON.stringify({ name: [name] }) });
  if (nets.find((n) => n.Name === name)) return name;
  await docker.createNetwork({ Name: name, Driver: 'bridge' });
  console.log(`[network] created docker network ${name}`);
  return name;
}

module.exports = { ensureNetwork, networkName };
