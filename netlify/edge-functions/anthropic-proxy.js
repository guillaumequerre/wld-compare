// netlify/edge-functions/anthropic-proxy.js
export default async function handler(request, context) {
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY non configurée" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.text();
    const parsed = JSON.parse(body);

    // Force streaming — avoids edge function timeout
    const streamBody = JSON.stringify({ ...parsed, stream: true });

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: streamBody,
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return new Response(errText, {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Pipe the SSE stream from Anthropic straight to the client
    // then reassemble into a single JSON message on the client side
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Reassemble SSE → single JSON response
    (async () => {
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const event = JSON.parse(data);
              if (event.type === "content_block_delta" && event.delta?.text) {
                fullText += event.delta.text;
              }
              if (event.type === "message_start" && event.message?.usage) {
                inputTokens = event.message.usage.input_tokens || 0;
              }
              if (event.type === "message_delta" && event.usage) {
                outputTokens = event.usage.output_tokens || 0;
              }
            } catch {}
          }
        }

        // Emit a single JSON response matching the standard Anthropic format
        const response = JSON.stringify({
          id: "streamed",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: fullText }],
          model: parsed.model || "claude-sonnet-4-20250514",
          stop_reason: "end_turn",
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        });

        await writer.write(encoder.encode(response));
      } catch (err) {
        await writer.write(encoder.encode(JSON.stringify({ error: err.message })));
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const config = {
  path: "/api/anthropic",
};