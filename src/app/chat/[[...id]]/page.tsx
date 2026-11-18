import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { DEFAULT_MODEL, MODEL_IDS, MODELS } from "@/config/models";
import { getConversationForDisplay, listConversations } from "@/lib/chat/conversations";
import { getAllowance } from "@/lib/limits/allowance";
import { ChatApp } from "@/components/chat/chat-app";
import { SignOutButton } from "@/components/sign-out-button";

export const metadata = { title: "Chat · MV Dugar AI Portal" };

export default async function ChatPage({ params }: PageProps<"/chat/[[...id]]">) {
  const user = await requireUser();
  const { id } = await params;
  if (id && id.length > 1) notFound();
  const conversationId = id?.[0] ?? null;

  const business = user.businessId
    ? await db.business.findUnique({
        where: { id: user.businessId },
        select: { allowedModels: true },
      })
    : null;
  const models = MODEL_IDS.filter((m) => business?.allowedModels.includes(m)).map((m) => ({
    id: m,
    label: MODELS[m].label,
    description: MODELS[m].description,
  }));

  const [conversations, allowance, current] = await Promise.all([
    listConversations(db, user.id),
    getAllowance(db, user.id),
    conversationId ? getConversationForDisplay(db, user.id, conversationId) : null,
  ]);
  if (conversationId && !current) redirect("/chat");

  return (
    <ChatApp
      user={{ name: user.name, businessName: user.businessName }}
      initialConversations={conversations.map((c) => ({
        ...c,
        updatedAt: c.updatedAt.toISOString(),
      }))}
      initialConversationId={current ? conversationId : null}
      initialMessages={current?.messages ?? []}
      initialAllowance={allowance}
      models={models}
      defaultModel={
        models.some((m) => m.id === DEFAULT_MODEL)
          ? DEFAULT_MODEL
          : (models[0]?.id ?? DEFAULT_MODEL)
      }
      signOut={<SignOutButton />}
    />
  );
}
