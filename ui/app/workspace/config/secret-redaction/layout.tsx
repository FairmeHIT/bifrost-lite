import { createFileRoute } from "@tanstack/react-router";
import SecretRedactionPage from "./page";

export const Route = createFileRoute("/workspace/config/secret-redaction")({
	component: SecretRedactionPage,
});