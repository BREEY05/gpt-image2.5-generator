const APP = process.env.APP_URL || "http://127.0.0.1:8787";

async function req(pathname, init) {
  const res = await fetch(APP + pathname, Object.assign({ headers: { "Content-Type": "application/json" } }, init));
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  if (!res.ok) throw new Error(pathname + " -> " + res.status + " " + text.slice(0, 300));
  return json;
}

const BATCHES = [
  {
    prompt: "A serene gradient poster with soft aurora color bands, minimal composition, fine grain, premium branding feel",
    params: { size: "1024x1024", quality: "high", n: 1, output_format: "png", background: "auto", output_compression: 90, moderation: "auto" }
  },
  {
    prompt: "霓虹雨夜的街角咖啡店，湿润路面反射招牌灯光，电影感构图，浅景深，高对比",
    params: { size: "1536x1024", quality: "medium", n: 2, output_format: "png", background: "auto", output_compression: 90, moderation: "auto" }
  },
  {
    prompt: "Botanical study of a monstera leaf, soft studio light, muted sage and cream palette, editorial photography",
    params: { size: "1024x1536", quality: "low", n: 2, output_format: "png", background: "auto", output_compression: 90, moderation: "auto" }
  }
];

async function main() {
  const state = await req("/api/state");
  let provider = state.providers.find((p) => p.baseUrl.indexOf("9911") !== -1);
  if (!provider) {
    const created = await req("/api/providers", {
      method: "POST",
      body: JSON.stringify({
        name: "本地演示 Mock",
        baseUrl: "http://127.0.0.1:9911/v1",
        authStyle: "bearer",
        apiKey: "sk-demo-key-8888",
        model: "gpt-image-2.5-flare"
      })
    });
    provider = created.provider;
    console.log("created provider", provider.id);
  }

  await req("/api/providers/" + provider.id + "/test", { method: "POST", body: JSON.stringify({ deep: false }) });
  console.log("provider tested");

  for (const batch of BATCHES) {
    const res = await req("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        providerId: provider.id,
        prompt: batch.prompt,
        mode: "generate",
        params: Object.assign({ model: "gpt-image-2.5-flare" }, batch.params)
      })
    });
    console.log("generated", res.generation.files.length, "image(s) in", res.generation.latencyMs, "ms");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
