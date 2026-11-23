/**
 * Who is logged in, and what they may do.
 *   admin:    manages provider accounts, sees every chart (read-only)
 *   provider: loads charts and runs summaries, and sees only their own
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "./session";
import { getChart, getUser } from "./store";
import type { Chart, Role, User } from "./types";

export async function getCurrentUser(): Promise<User | null> {
  const id = readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  return id ? ((await getUser(id)) ?? null) : null;
}

/** For pages: redirect to /login (or home) unless the user has the role. */
export async function requirePageUser(role?: Role): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (role && user.role !== role) redirect("/");
  return user;
}

/** For API routes: returns the user, or a 401/403 response to send back. */
export async function requireApiUser(role?: Role): Promise<User | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { title: "Please log in", message: "Your session has ended. Log in again." } }, { status: 401 });
  }
  if (role && user.role !== role) {
    return NextResponse.json(
      { error: { title: "Not allowed", message: role === "admin" ? "Only the admin can do this." : "Only providers can add charts." } },
      { status: 403 },
    );
  }
  return user;
}

export function canView(user: User, chart: Chart): boolean {
  return user.role === "admin" || chart.provider.id === user.id;
}

/**
 * Loads a chart for an API route. Someone else's chart is reported as not found.
 * With `write`, only the provider who owns it may continue (the admin is read-only).
 */
export async function requireChartAccess(id: string, write = false): Promise<{ user: User; chart: Chart } | NextResponse> {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const chart = await getChart(id);
  if (!chart || !canView(user, chart)) {
    return NextResponse.json({ error: { title: "Not found", message: "That chart does not exist." } }, { status: 404 });
  }
  if (write && chart.provider.id !== user.id) {
    return NextResponse.json({ error: { title: "Read only", message: "Only the provider who added this chart can change it." } }, { status: 403 });
  }
  return { user, chart };
}
