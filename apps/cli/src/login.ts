/**
 * CLI login command — authenticates with Supabase via OAuth or email.
 * Stores credentials in ~/.agent-valley/credentials.json (0600).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import * as p from "@clack/prompts"
import pc from "picocolors"

const CONFIG_DIR = join(homedir(), ".agent-valley")
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json")

export interface Credentials {
  accessToken: string
  refreshToken: string
  expiresAt: number
  supabaseUrl: string
  userId: string
  email: string
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  }
}

export function saveCredentials(creds: Credentials): void {
  ensureConfigDir()
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 })
}

export function loadCredentials(): Credentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null
  try {
    const raw = readFileSync(CREDENTIALS_FILE, "utf-8")
    return JSON.parse(raw) as Credentials
  } catch {
    return null
  }
}

export function clearCredentials(): void {
  if (existsSync(CREDENTIALS_FILE)) {
    writeFileSync(CREDENTIALS_FILE, "", { mode: 0o600 })
  }
}

async function loginWithEmail(supabaseUrl: string, supabaseAnonKey: string): Promise<Credentials> {
  const email = await p.text({
    message: "Email",
    placeholder: "you@company.com",
    validate: (v) => (!v?.includes("@") ? "Please enter a valid email" : undefined),
  })
  if (p.isCancel(email)) {
    p.cancel("Cancelled")
    process.exit(0)
  }

  const password = await p.password({
    message: "Password",
    validate: (v) => ((v?.length ?? 0) < 6 ? "Password must be at least 6 characters" : undefined),
  })
  if (p.isCancel(password)) {
    p.cancel("Cancelled")
    process.exit(0)
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const msg = (body.error_description ?? body.msg ?? "Login failed") as string
    throw new Error(msg)
  }

  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    user: { id: string; email: string }
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    supabaseUrl,
    userId: data.user.id,
    email: data.user.email,
  }
}

async function signupWithEmail(supabaseUrl: string, supabaseAnonKey: string): Promise<Credentials> {
  const email = await p.text({
    message: "Email",
    placeholder: "you@company.com",
    validate: (v) => (!v?.includes("@") ? "Please enter a valid email" : undefined),
  })
  if (p.isCancel(email)) {
    p.cancel("Cancelled")
    process.exit(0)
  }

  const password = await p.password({
    message: "Password (min 6 characters)",
    validate: (v) => ((v?.length ?? 0) < 6 ? "Password must be at least 6 characters" : undefined),
  })
  if (p.isCancel(password)) {
    p.cancel("Cancelled")
    process.exit(0)
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const msg = (body.error_description ?? body.msg ?? "Signup failed") as string
    throw new Error(msg)
  }

  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    user: { id: string; email: string }
  }

  if (!data.access_token) {
    p.log.info("A verification link has been sent to your email. Please verify and log in again.")
    process.exit(0)
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    supabaseUrl,
    userId: data.user.id,
    email: data.user.email,
  }
}

export async function login(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" Agent Valley Login ")))

  const existing = loadCredentials()
  if (existing && existing.expiresAt > Date.now()) {
    p.log.info(`Already logged in as: ${existing.email}`)
    const relogin = await p.confirm({ message: "Log in again?" })
    if (p.isCancel(relogin) || !relogin) {
      p.outro("Keeping existing login")
      return
    }
  }

  const supabaseUrl = await p.text({
    message: "Supabase URL",
    placeholder: "https://xxx.supabase.co",
    validate: (v) => (!v?.startsWith("https://") ? "Must start with https://" : undefined),
  })
  if (p.isCancel(supabaseUrl)) {
    p.cancel("Cancelled")
    process.exit(0)
  }

  const supabaseAnonKey = await p.text({
    message: "Supabase Anon Key",
    placeholder: "eyJhbGciOiJIUzI1NiIs...",
    validate: (v) => ((v?.length ?? 0) < 20 ? "Please enter a valid key" : undefined),
  })
  if (p.isCancel(supabaseAnonKey)) {
    p.cancel("Cancelled")
    process.exit(0)
  }

  const action = await p.select({
    message: "Authentication method",
    options: [
      { value: "login", label: "Log in with existing account" },
      { value: "signup", label: "Create new account" },
    ],
  })
  if (p.isCancel(action)) {
    p.cancel("Cancelled")
    process.exit(0)
  }

  const spinner = p.spinner()
  spinner.start("Authenticating...")

  try {
    const creds =
      action === "signup"
        ? await signupWithEmail(supabaseUrl as string, supabaseAnonKey as string)
        : await loginWithEmail(supabaseUrl as string, supabaseAnonKey as string)

    saveCredentials(creds)
    spinner.stop("Authentication complete")

    p.log.success(`Logged in as ${creds.email}`)
    p.log.info(`Credentials saved: ${CREDENTIALS_FILE}`)
    p.outro(pc.green("Login complete!"))
  } catch (err) {
    spinner.stop("Authentication failed")
    p.log.error(String(err instanceof Error ? err.message : err))
    p.outro(pc.red("Login failed. Please try again."))
    process.exit(1)
  }
}

export async function logout(): Promise<void> {
  clearCredentials()
  p.log.success("Logged out")
}
