const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.startsWith("pnpm/")) {
  console.error("This project uses pnpm. Run the command with pnpm 12.21.0.");
  process.exit(1);
}
