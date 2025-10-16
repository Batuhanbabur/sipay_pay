// Vercel API Route: /api/gs-log
// İstemci → (CORS OK) → Vercel → (server-side) → Google Apps Script (no CORS problemi)
export const config = { runtime: "edge" }; // hızlı

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxM58aX4b3iHgmF7SA0pA064mot2lRDx6ehvq2A3hqX5vBad2aPOXc1GG3goF4MIE3jZQ/exec";

// Basit CORS
function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders("*") });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD" }), {
      status: 405,
      headers: { ...corsHeaders("*"), "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Apps Script’e sunucu tarafında POST (CORS yok)
  let status = 200;
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    status = 502;
  }

  return new Response(JSON.stringify({ ok: true }), {
    status,
    headers: { ...corsHeaders("*"), "Content-Type": "application/json" },
  });
}
