# ComfyUI_FunCode

一组面向 ComfyUI 的自定义节点集合，提供常用图像工具与 LLM 节点。

## 功能概览

- **FunCode/Image**
  - **Load Image FunCode**：从 input 目录选择并加载图片。
  - **Color Match FunCode**：对齐参考图的色彩风格（颜色匹配/迁移）。
  - **Empty Latent FunCode**：按常用分辨率预设生成空 latent。
  - **Canvas Data FunCode**：聚合背景与叠加图层数据。
  - **Canvas Editor FunCode**：可视化编辑画布并导出合成图像。
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

### Canvas Data FunCode

- 用途：将背景图与多个叠加图层打包为画布数据。
- 输出：fc_data_json。

### Canvas Editor FunCode

- 用途：在画布上可视化编辑图层、文本与背景。
- 输入：fc_data_json（来自 Canvas Data FunCode）。
- 输出：image（合成后的图像）。
- 保存：保存到 `ComfyUI/input/FunCodeCanvas` 目录。
- 导入：从 `ComfyUI/input/FunCodeCanvas` 目录导入。

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

- 选择默认配置或已配置的 Profile：仅使用该配置的 `api_base`、`api_key`、`model`，面板中的值会被忽略，即使配置字段为空也不会回退到面板值。
- 选择“自定义”：使用面板中的这三个字段。

### 2) 系统提示词模板（可选）

将系统提示词文件放到项目根目录：`ComfyUI_FunCode/system_prompts/`（节点加载时自动创建）。旧目录 `llm/system_prompts/` 中的文件需移动到新目录。

- 支持：`.md` / `.txt`
- 节点下拉会自动加载目录内所有文件
- 选择 `custom`：使用面板输入框内容

### 3) 可选图片与采样参数

- 图片可不连接；初始显示 `image`，连接后自动显示下一个备用接口，最多为 `image`、`image_2` … `image_10`。断开连接后收起多余的末尾空接口。
- 图片按接口编号顺序发送；每个接口沿用原有行为，使用图像批次中的第一张图片。服务端需支持多图输入。
- 新增参数默认值：`top_k=0`、`min_p=0.0`、`repeat_penalty=1.0`、`presence_penalty=0.0`、`frequency_penalty=0.0`。
- 为兼容不同服务，`top_k`、`min_p`、`repeat_penalty` 在上述默认值时不发送，使用服务端默认行为；修改后分别以 `top_k`、`min_p`、`repetition_penalty` 发送，需服务端支持。两个 penalty 参数始终发送。
- 更新后重启 ComfyUI 并刷新浏览器，以加载动态图片接口扩展。
