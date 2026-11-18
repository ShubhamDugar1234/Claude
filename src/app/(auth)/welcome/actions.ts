"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export async function acceptNotice() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (!user.noticeAcceptedAt) {
    await db.user.update({ where: { id: user.id }, data: { noticeAcceptedAt: new Date() } });
  }
  redirect("/chat");
}
