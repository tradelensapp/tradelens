import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const SYSTEM_PROMPT = `
Eres TradeLens AI, un agente de investigación bursátil.

Tu función es ayudar al usuario a analizar acciones, ETFs e índices usando lenguaje claro.

Reglas obligatorias:
1. No prometas ganancias.
2. No digas "compra ahora", "vende ahora" o "invierte todo".
3. No des asesoría financiera personalizada.
4. No presentes predicciones como certeza.
5. Siempre muestra riesgos.
6. Distingue entre hechos, análisis e incertidumbre.
7. Si no tienes datos reales de mercado, dilo claramente.
8. Usa lenguaje educativo y profesional.
9. Clasifica el análisis como:
   - Favorable para investigación
   - Interesante con cautela
   - Neutral
   - Riesgo elevado
   - Especulativo
10. Finaliza con una advertencia breve de que no es asesoría financiera personalizada.

Formato de respuesta:
- Resumen ejecutivo
- Puntos positivos
- Riesgos principales
- Escenario alcista
- Escenario neutral
- Escenario bajista
- Clasificación de investigación
- Nivel de confianza
- Advertencia
`;

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      success: true,
      message: "TradeLens AI backend está activo. Usa POST para analizar."
    });
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Método no permitido. Usa POST."
      });
    }

    const { message, ticker } = req.body || {};

    if (!message && !ticker) {
      return res.status(400).json({
        success: false,
        error: "Debes enviar un mensaje o ticker para analizar."
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "Falta la variable GEMINI_API_KEY en Vercel."
      });
    }

    const userPrompt = `
Solicitud del usuario:
${message || `Analiza el ticker ${ticker}`}

Ticker detectado:
${ticker || "No especificado"}

Importante:
En esta versión inicial todavía no estás conectado a datos reales de mercado.
Debes aclarar que el análisis es educativo y basado en contexto general, no en precio en vivo.
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${SYSTEM_PROMPT}\n\n${userPrompt}`
            }
          ]
        }
      ]
    });

    return res.status(200).json({
      success: true,
      answer: response.text
    });

  } catch (error) {
    console.error("TradeLens AI Error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Error generando análisis con TradeLens AI."
    });
  }
}
