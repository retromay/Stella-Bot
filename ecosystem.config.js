const argEnvIndex = process.argv.indexOf("--env");
let argEnv = (argEnvIndex !== -1 && process.argv[argEnvIndex + 1]) || "";

const RUN_ENV_MAP = {
  prod: {
    instances: 1,
    max_memory_restart: "1000M",
  },
};

if (!(argEnv in RUN_ENV_MAP)) {
  argEnv = "prod";
}

module.exports = {
  apps: [
    {
      name: "stella-bot",
      script: "dist/index.js",
      args: "start",
      instances: RUN_ENV_MAP[argEnv].instances,
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: RUN_ENV_MAP[argEnv].max_memory_restart,
      env_prod: {
        APP_ENV: "prod",
        PORT: 6350,
      },
    },
  ],
};
