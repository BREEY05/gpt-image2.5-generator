export const SIZE_PRESETS = ["1024x1024", "1536x1024", "1024x1536", "2048x2048", "2560x1440"];

export const PRESET_MODELS = [
  {
    id: "gpt-image-2.5-sunburst",
    label: "GPT-Image-2.5 Sunburst",
    note: "最强，编辑精度优先",
    family: "2.5",
    quality: ["low", "medium", "high", "xhigh", "max", "auto"],
    customSize: true,
    maxN: 10,
    formats: ["png", "jpeg", "webp"],
    background: true,
    edit: true
  },
  {
    id: "gpt-image-2.5-flare",
    label: "GPT-Image-2.5 Flare",
    note: "最快，日常出图",
    family: "2.5",
    quality: ["low", "medium", "high", "xhigh", "max", "auto"],
    customSize: true,
    maxN: 10,
    formats: ["png", "jpeg", "webp"],
    background: true,
    edit: true
  },
  {
    id: "gpt-image-2",
    label: "GPT-Image-2",
    note: "4K / 宽幅比 / 编辑",
    family: "2",
    quality: ["low", "medium", "high"],
    customSize: true,
    maxN: 10,
    formats: ["png", "jpeg", "webp"],
    background: true,
    edit: true
  },
  {
    id: "gpt-image-1.5",
    label: "GPT-Image-1.5",
    note: "真实感 / 指令遵循",
    family: "1.5",
    quality: ["low", "medium", "high"],
    customSize: false,
    maxN: 10,
    formats: ["png", "jpeg", "webp"],
    background: true,
    edit: true
  },
  {
    id: "gpt-image-1",
    label: "GPT-Image-1",
    note: "通用",
    family: "1",
    quality: ["low", "medium", "high"],
    customSize: false,
    maxN: 10,
    formats: ["png", "jpeg", "webp"],
    background: true,
    edit: true
  },
  {
    id: "gpt-image-1-mini",
    label: "GPT-Image-1 Mini",
    note: "便宜 / 批量草稿",
    family: "1-mini",
    quality: ["low", "medium", "high"],
    customSize: false,
    maxN: 10,
    formats: ["png", "jpeg", "webp"],
    background: true,
    edit: true
  }
];

export const DEFAULT_CAPS = {
  id: "custom",
  label: "自定义模型",
  note: "未收录的模型，参数按通用能力处理",
  quality: ["low", "medium", "high", "auto"],
  customSize: true,
  maxN: 4,
  formats: ["png", "jpeg", "webp"],
  background: true,
  edit: true
};

export function capsFor(model) {
  const id = String(model || "").toLowerCase();
  if (!id) return DEFAULT_CAPS;
  const hit = PRESET_MODELS.find(function (p) { return id === p.id; })
    || PRESET_MODELS.find(function (p) { return id.indexOf(p.id) === 0; })
    || PRESET_MODELS.find(function (p) { return p.family && id.indexOf("image-" + p.family) !== -1; })
    || PRESET_MODELS.find(function (p) { return id.indexOf("gpt-image") !== -1; });
  return hit ? Object.assign({}, hit) : DEFAULT_CAPS;
}

export function defaultParams(model) {
  const caps = capsFor(model);
  return {
    model: model || PRESET_MODELS[0].id,
    size: "1024x1024",
    quality: caps.quality.indexOf("medium") !== -1 ? "medium" : caps.quality[0],
    n: 1,
    output_format: "png",
    background: "auto",
    output_compression: 100,
    moderation: "auto"
  };
}
