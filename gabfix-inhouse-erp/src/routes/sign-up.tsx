import { createFileRoute } from "@tanstack/react-router";
import SignUpPage from "@/components/SignUpPage";

export const Route = createFileRoute("/sign-up")({
  head: () => ({
    meta: [
      { title: "Create your account — Gabfix Portal" },
      {
        name: "description",
        content: "Create your Gabfix Portal account with the invite code issued by the Admin Console.",
      },
    ],
  }),
  component: SignUpPage,
});