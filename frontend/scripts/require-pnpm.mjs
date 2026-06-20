const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.startsWith("pnpm/")) {
  console.error("This project uses pnpm. Run the command with pnpm 10.30.2.");
  process.exit(1);
}
