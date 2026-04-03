import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function generateCarPoster(prompt: string, imageBase64?: string) {
  const model = ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          { text: `你是一个专业的汽车销售和社交媒体专家。请根据以下信息生成一段吸引人的朋友圈文案，并附带相关的表情符号。
          信息：${prompt}
          要求：文案要专业、热情、有感染力，适合在微信朋友圈发布。` },
          ...(imageBase64 ? [{ inlineData: { data: imageBase64.split(',')[1], mimeType: "image/jpeg" } }] : [])
        ]
      }
    ]
  });

  const response = await model;
  return response.text;
}

export async function generateCarImage(prompt: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          text: `一张高质量的汽车宣传海报，展示：${prompt}。风格现代、高端、大气，适合朋友圈分享。`,
        },
      ],
    },
    config: {
      imageConfig: {
            aspectRatio: "1:1",
        },
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  return null;
}
