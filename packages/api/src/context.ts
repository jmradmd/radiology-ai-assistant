import type { User } from "@rad-assist/db";
import { prisma } from "@rad-assist/db";
import { createClient } from "@supabase/supabase-js";
import { jwtDecode } from "jwt-decode";

export interface Context {
  prisma: typeof prisma;
  user: User | null;
  req?: Request;
}

// Create Supabase client for token verification
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

interface JwtPayload {
  sub: string;
  email?: string;
  exp?: number;
  aud?: string;
}

async function findUserByExternalIdOrEmail(
  externalId?: string | null,
  email?: string | null
): Promise<User | null> {
  if (externalId) {
    const userByExternalId = await prisma.user.findUnique({
      where: { externalId },
    });
    if (userByExternalId) {
      return userByExternalId;
    }
  }

  if (email) {
    const userByEmail = await prisma.user.findUnique({
      where: { email },
    });
    if (userByEmail) {
      return userByEmail;
    }
  }

  return null;
}

export async function createContext(opts?: {
  req?: Request;
  user?: User | null;
}): Promise<Context> {
  let user: User | null = opts?.user ?? null;

  // Try to extract user from authorization header
  if (opts?.req && !user) {
    const authHeader = opts.req.headers.get("authorization");
    console.log('[Auth] Authorization header:', authHeader ? 'present' : 'NONE');
    
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      console.log('[Auth] Token type:', token === 'demo-token' ? 'DEMO' : 'JWT');
      
      // Handle demo token — only in non-production environments
      if (token === "demo-token" && process.env.NODE_ENV !== "production") {
        console.log('[Auth] Looking up demo user...');
        user = await prisma.user.findUnique({
          where: { email: "demo@example.com" },
        });
        console.log('[Auth] Found demo user:', user?.email || 'NONE');

        // Create demo user if it doesn't exist
        if (!user) {
          console.log('[Auth] Creating demo user...');
          user = await prisma.user.upsert({
            where: { email: "demo@example.com" },
            create: {
              email: "demo@example.com",
              name: "Demo User",
              role: "COORDINATOR",
              department: "Radiology",
              subspecialty: "ABDOMINAL",
              isActive: true,
            },
            update: {},
          });
          console.log('[Auth] Created demo user:', user.email);
        }
      } else if (token === "demo-token") {
        // In production, demo-token is ignored — fall through to normal auth (will fail with UNAUTHORIZED)
        console.warn('[Auth] demo-token rejected in production');
      } else if (supabase) {
        // Verify Supabase token using the client
        try {
          const { data: { user: authUser }, error } = await supabase.auth.getUser(token);
          
          if (error) {
            console.error("[Auth] Supabase getUser failed", {
              message: error.message,
              status: error.status,
            });
          } else if (!authUser) {
            console.warn("[Auth] Supabase getUser returned no user");
          } else {
            user = await findUserByExternalIdOrEmail(authUser.id, authUser.email);
            
            // Auto-create user if they exist in Supabase but not in our DB
            if (!user && authUser.email) {
              user = await prisma.user.create({
                data: {
                  externalId: authUser.id,
                  email: authUser.email,
                  name: authUser.user_metadata?.name || authUser.email.split("@")[0],
                  role: "STAFF",
                  isActive: true,
                },
              });
            } else if (user && !user.externalId) {
              user = await prisma.user.update({
                where: { id: user.id },
                data: { externalId: authUser.id },
              });
            }
          }

          // Supabase verification failed — do not fall back to unverified decode
          if (!user && error) {
            console.error('[Auth] Supabase token verification failed. Cannot authenticate.');
          }
        } catch (err) {
          console.error("Token verification error:", err);
        }
      } else {
        // Supabase not configured — cannot verify tokens
        console.warn('[Auth] Supabase not configured. Token verification unavailable. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
      }
    }
  }

  console.log('[Auth] Context user:', user?.email || 'NULL');
  
  return {
    prisma,
    user,
    req: opts?.req,
  };
}
