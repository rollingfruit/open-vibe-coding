/**
 * LLMService - A service to interact with a streaming LLM API.
 */
export class LLMService {
    constructor(settings) {
        this.settings = settings;
    }

    /**
     * Streams a code modification from the LLM API.
     * @param {string} codeToEdit - The code to be modified.
     * @param {string} instruction - The user's instruction.
     * @param {function(string): void} onData - Callback for each text chunk.
     * @param {function(): void} onComplete - Callback for when the stream is done.
     * @param {function(Error): void} onError - Callback for any errors.
     */
    async streamCodeModification({ codeToEdit, instruction, onData, onComplete, onError }) {
        try {
            const response = await fetch(this.settings.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    temperature: 0.7,
                    stream: true,
                    messages: [
                        {
                            role: "system",
                            content: `You are a code assistant. The user will provide code and an instruction. Return the modified code directly, without any explanations or markdown formatting. Just output the raw modified code.`
                        },
                        {
                            role: "user",
                            content: `Instruction: ${instruction}\n\nCode to modify:\n${codeToEdit}`
                        }
                    ]
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            let fullContent = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split("\n\n");
                buffer = lines.pop(); // Keep the last, possibly incomplete, chunk in buffer

                for (const line of lines) {
                    if (line.startsWith("data:")) {
                        const data = line.slice(5).trim();

                        if (data === "[DONE]") {
                            console.log("LLM流式响应完成，总长度:", fullContent.length);
                            onComplete();
                            return; // Exit the loop and function
                        }

                        try {
                            const parsed = JSON.parse(data);
                            const deltaContent = parsed.choices?.[0]?.delta?.content;

                            if (deltaContent) {
                                fullContent += deltaContent;
                                // 将文本块传递给回调
                                onData(deltaContent);
                            }
                        } catch (e) {
                            // This can happen with partial JSON, ignore and wait for more data
                            console.debug("Could not parse SSE data:", e.message);
                        }
                    }
                }
            }
            onComplete(); // Ensure onComplete is called if stream ends without [DONE]
        } catch (error) {
            onError(error);
        }
    }
}