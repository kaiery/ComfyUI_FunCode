# ComfyUI_FunCode

一组面向 ComfyUI 的自定义节点集合，提供常用图像工具与 LLM 节点。

## 功能概览

- **FunCode/Image**
  - **Load Image FunCode**：从 input 目录选择并加载图片。
  - **Color Match FunCode**：对齐参考图的色彩风格（颜色匹配/迁移）。
  - **Empty Latent FunCode**：按常用分辨率预设生成空 latent。
- **FunCode/LLM**
  - **Any LLM FunCode**：调用任意大模型，支持系统提示词/用户提示词，可选输入图像（取决于服务端是否支持）。

## 安装

1. 将本仓库放入 ComfyUI 的 `custom_nodes` 目录：

   ```text
   ComfyUI/custom_nodes/ComfyUI_FunCode
   ```

2. 安装依赖（仅 Color Match 需要额外依赖）：

   ```bash
   pip install -r requirements.txt
   ```

3. 重启 ComfyUI。

## 使用说明

安装完成后，在节点面板中可在以下分类找到本项目节点：

- `FunCode/Image`
- `FunCode/LLM`

### Load Image FunCode

- 用途：从 ComfyUI 的 input 目录选择图片并加载。
- 输出：image、mask。

### Color Match FunCode

- 用途：将目标图的色彩风格向参考图对齐。
- 提示：首次使用前请确保已安装依赖（见上面的安装步骤）。

### Empty Latent FunCode

- 用途：快速创建指定分辨率的空 latent（内置预设，也支持自定义宽高）。

### Any LLM FunCode

- 用途：调用你配置的 LLM 服务，输出文本。
- 典型用法：设置系统提示词（可选）、用户提示词，然后执行。

## Any LLM：配置

### 1) .env（推荐）

在本项目根目录创建 `.env`（可参考 [.env.example](./.env.example)），至少填：

- `LLM_API_BASE`
- `LLM_API_KEY`
- `LLM_MODEL`

如需在节点里通过下拉快速切换多套配置，可添加多 Profile（示例见 .env.example）。

### 2) 系统提示词模板（可选）

将系统提示词文件放到：`llm/system_prompts/`

- 支持：`.md` / `.txt`
- 节点下拉会自动加载目录内所有文件
- 选择 `custom`：使用面板输入框内容

