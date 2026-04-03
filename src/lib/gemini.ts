import { GoogleGenAI, Type } from "@google/genai";

// 仅在本地/预览环境（有 API Key 时）初始化 SDK
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

async function callProxy(model: string, contents: any, config?: any) {
  // 优先尝试调用 Vercel 代理接口（生产环境）
  try {
    const response = await fetch('/api/generate-content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, contents, config }),
    });

    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    // 如果在非 Vercel 环境下 fetch 失败是正常的
    console.log("Proxy not available, trying direct SDK call...");
  }

  // 如果代理不可用且有本地 Key，则直接调用 SDK（开发环境）
  if (ai) {
    return await ai.models.generateContent({ model, contents, config });
  }

  throw new Error('无法连接到 AI 服务，请检查 API Key 或部署配置。');
}

export async function generateCarPoster(prompt: string, imageBase64?: string) {
  const contents = [
    {
      parts: [
        { text: `你是一个专业的汽车销售和社交媒体专家。请根据以下信息生成 3 个不同风格的吸引人的朋友圈文案，并附带相关的表情符号。
        信息：${prompt}
        要求：文案要专业、热情、有感染力，适合在微信朋友圈发布。
        风格1：专业稳重
        风格2：热情活泼
        风格3：简洁有力` },
        ...(imageBase64 ? [{ inlineData: { data: imageBase64.split(',')[1], mimeType: "image/jpeg" } }] : [])
      ]
    }
  ];

  const config = {
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        options: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "3个不同风格的文案方案"
        }
      },
      required: ["options"]
    }
  };

  const response = await callProxy("gemini-3-flash-preview", contents, config);

  try {
    // The response from our proxy is the full GenerateContentResponse object
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    const data = JSON.parse(text || '{"options":[]}');
    return data;
  } catch (e) {
    console.error("Failed to parse AI response:", e);
    return { options: [response.candidates?.[0]?.content?.parts?.[0]?.text || ""] };
  }
}

export async function generateCarImage(prompt: string) {
  const contents = {
    parts: [
      {
        text: `一张高质量的汽车宣传海报，展示：${prompt}。风格现代、高端、大气，适合朋友圈分享。`,
      },
    ],
  };

  const config = {
    imageConfig: {
      aspectRatio: "1:1",
    },
  };

  const response = await callProxy('gemini-2.5-flash-image', contents, config);

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  return null;
}
