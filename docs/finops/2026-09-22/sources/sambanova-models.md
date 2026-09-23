SambaCloud currently supports the following models for all developer accounts. For definitions of the **Production** and **Preview** designations, see the [Glossary](/docs/en/resources/glossary).

##

[​

](#production-models)

Production models

Production models are intended for use in production environments and meet SambaNova’s high standards for speed and quality.

| Developer | Model ID | Context length | Supported modalities | View on Hugging Face |
| MiniMax | MiniMax-M2.7 | 192k tokens | Text | Model card |
| DeepSeek | DeepSeek-V3.1 | 128k tokens | Text | Model card |
| Meta | Meta-Llama-3.3-70B-Instruct | 128k tokens | Text | Model card |
| OpenAI | gpt-oss-120b | 128k tokens | Text | Model card |

* * *

##

[​

](#preview-models)

Preview models

Preview models are intended for evaluation purposes and developer experimentation only, and should not be used in production environments. These models have limited capacity and may be removed at short notice.

| Developer | Model ID | Context length | Supported modalities | View on Hugging Face |
| MiniMax | MiniMax-M3 | 1M tokens | Text, Image | Model card |
| DeepSeek | DeepSeek-V3.2 | 32k tokens | Text | Model card |
| Google | gemma-4-31B-it | 128k tokens | Text, Image, Video | Model card |

`MiniMax-M3` supports text and image input on SambaCloud. Video input is **not** supported on SambaCloud.

`gemma-4-31B-it` supports text, image, and video input. Audio input is **not** supported for this model.
