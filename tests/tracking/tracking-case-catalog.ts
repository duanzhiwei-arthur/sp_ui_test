import type { TrackingPlatform } from './tracking-collector.js';

export type TrackingCaseKind = 'business' | 'exception';

export interface TrackingCase {
  id: string;
  kind: TrackingCaseKind;
  name: string;
  requiredParams: readonly string[];
  platforms: readonly TrackingPlatform[];
  /** Platforms that must not receive the event. Useful for explicit routing contracts. */
  forbiddenPlatforms?: readonly TrackingPlatform[];
  actionDescription: string;
}

/** Generated from the approved Feishu tracking test document (2026-08-10). */
export const trackingCaseCatalog = [
  {
    "id": "DOC-001",
    "kind": "business",
    "name": "POD_Canvas_Album_Click",
    "requiredParams": [],
    "platforms": [
      "ga4"
    ],
    "actionDescription": "用户点击toolbar上传图片按钮"
  },
  {
    "id": "DOC-002",
    "kind": "business",
    "name": "POD_Canvas_Upgrade_Click",
    "requiredParams": [
      "mode"
    ],
    "platforms": [
      "ga4"
    ],
    "actionDescription": "用户点击切换画板模式按钮，记录切换后mode todo"
  },
  {
    "id": "DOC-003",
    "kind": "business",
    "name": "POD_diy_template_impression",
    "requiredParams": [
      "template_id"
    ],
    "platforms": [
      "ga4"
    ],
    "actionDescription": "初始风格上报和用户切换风格选项时"
  },
  {
    "id": "DOC-004",
    "kind": "business",
    "name": "POD_FigureMode_Switch",
    "requiredParams": [
      "figure_mode"
    ],
    "platforms": [
      "ga4"
    ],
    "actionDescription": "用户点击 任务模式切换按钮"
  },
  {
    "id": "DOC-005",
    "kind": "business",
    "name": "POD_Generate_Start",
    "requiredParams": [
      "style_type",
      "figure_mode",
      "input_type"
    ],
    "platforms": [
      "ga4"
    ],
    "actionDescription": "用户生成预设 和 用户生成自定义模型时 todo"
  },
  {
    "id": "DOC-006",
    "kind": "business",
    "name": "click_basic_or_pro",
    "requiredParams": [
      "mode"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "用户点击切换画板模式按钮时，记录切换前mode todo"
  },
  {
    "id": "DOC-007",
    "kind": "business",
    "name": "diy_refine_click",
    "requiredParams": [
      "record_id",
      "figure_mode",
      "style_type"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "用户点击 refine 按钮时"
  },
  {
    "id": "DOC-008",
    "kind": "business",
    "name": "generate_with_pro",
    "requiredParams": [],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "用户选择 Pro 方案并开始生成时 todo"
  },
  {
    "id": "DOC-009",
    "kind": "business",
    "name": "POD_Canvas_Generate_Click",
    "requiredParams": [],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "用户点击 Generate 按钮时"
  },
  {
    "id": "DOC-010",
    "kind": "business",
    "name": "POD_Canvas_Paint_Click",
    "requiredParams": [],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "pro模式 画笔按钮点击时"
  },
  {
    "id": "DOC-011",
    "kind": "business",
    "name": "POD_Canvas_Retry_Click",
    "requiredParams": [],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "2d重试时 todo：没有拆分因为什么重试，也没有3d重试记录"
  },
  {
    "id": "DOC-012",
    "kind": "business",
    "name": "POD_Canvas_Text_Click",
    "requiredParams": [],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "pro模式 prompt按钮点击"
  },
  {
    "id": "DOC-013",
    "kind": "business",
    "name": "POD_diy_Inspiration_click",
    "requiredParams": [
      "template_id",
      "source"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "选择预设模型时"
  },
  {
    "id": "DOC-014",
    "kind": "business",
    "name": "POD_diy_Inspiration_impression",
    "requiredParams": [],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "预设模型列表有内容时"
  },
  {
    "id": "DOC-015",
    "kind": "business",
    "name": "POD_diy_template_select",
    "requiredParams": [
      "template_id",
      "previous_template_id"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "生成风格切换时"
  },
  {
    "id": "DOC-016",
    "kind": "business",
    "name": "POD_Gallery_View",
    "requiredParams": [],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "每次进入 gallery tab 时"
  },
  {
    "id": "DOC-017",
    "kind": "business",
    "name": "POD_Generate_Error",
    "requiredParams": [
      "style_type",
      "figure_mode",
      "error",
      "error_code",
      "record_id"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "后端生成资产失败、连接中断、脚本异常 时"
  },
  {
    "id": "DOC-018",
    "kind": "business",
    "name": "POD_Generate_Poll_Fallback",
    "requiredParams": [
      "record_id",
      "error"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "sse连接断开回退轮询时"
  },
  {
    "id": "DOC-019",
    "kind": "business",
    "name": "POD_Generate_success",
    "requiredParams": [
      "style_type",
      "figure_mode",
      "record_id"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "sse、全轮询 2d生成成功,todo:没有3d生成成功的埋点"
  },
  {
    "id": "DOC-020",
    "kind": "business",
    "name": "POD_Poll_Error",
    "requiredParams": [
      "record_id",
      "error"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "全轮询失败时"
  },
  {
    "id": "DOC-021",
    "kind": "business",
    "name": "POD_Poll_Timeout",
    "requiredParams": [
      "record_id",
      "error"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "全轮询后端生成超过 15min 时"
  },
  {
    "id": "DOC-022",
    "kind": "business",
    "name": "POD_Upload_Start",
    "requiredParams": [
      "file_type",
      "file_size"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "全轮询文件上传开始 时"
  },
  {
    "id": "DOC-023",
    "kind": "business",
    "name": "POD_Upload_Success",
    "requiredParams": [
      "record_id",
      "file_url"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "全轮询文件上传成功 时"
  },
  {
    "id": "DOC-024",
    "kind": "business",
    "name": "diy_2D_impression",
    "requiredParams": [
      "template_id"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "每次展示2d图 时"
  },
  {
    "id": "DOC-025",
    "kind": "business",
    "name": "diy_3D_impression",
    "requiredParams": [
      "template_id"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "每次展示3d图 时"
  },
  {
    "id": "DOC-026",
    "kind": "business",
    "name": "diy_history_click",
    "requiredParams": [
      "template_id"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "用户点击历史资产 时"
  },
  {
    "id": "DOC-027",
    "kind": "business",
    "name": "membership_entry_view",
    "requiredParams": [
      "entry_page"
    ],
    "platforms": [
      "ga4"
    ],
    "actionDescription": "画板中会员入口、购物车会员入口 曝光时"
  },
  {
    "id": "DOC-028",
    "kind": "business",
    "name": "POD_diy_view",
    "requiredParams": [
      "entry_page"
    ],
    "platforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "画板渲染完成时"
  },
  {
    "id": "DOC-029",
    "kind": "business",
    "name": "jjb_canvas_v3_basic_image_delete",
    "requiredParams": [],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "basic 画板图片删除时"
  },
  {
    "id": "DOC-030",
    "kind": "exception",
    "name": "jjb_canvas_v3_canvas_export_tainted_error",
    "requiredParams": [],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "合成图片导出链接失败 时"
  },
  {
    "id": "DOC-031",
    "kind": "business",
    "name": "jjb_canvas_v3_canvas_image_added",
    "requiredParams": [
      "imageHeight",
      "imageWidth"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "pro画板添加图片时"
  },
  {
    "id": "DOC-032",
    "kind": "exception",
    "name": "jjb_canvas_v3_canvas_image_read_error",
    "requiredParams": [
      "fileName",
      "fileSize",
      "fileType"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "pro画板添加图片失败时"
  },
  {
    "id": "DOC-033",
    "kind": "business",
    "name": "jjb_canvas_v3_canvas_image_read_start",
    "requiredParams": [
      "fileName",
      "fileSize",
      "fileType"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "pro画板读取上传图片开始时"
  },
  {
    "id": "DOC-034",
    "kind": "business",
    "name": "jjb_canvas_v3_canvas_object_delete",
    "requiredParams": [
      "key",
      "method",
      "objectCount",
      "objectType"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户删除pro画板的图片或对象时"
  },
  {
    "id": "DOC-035",
    "kind": "business",
    "name": "jjb_canvas_v3_cart_action_blocked",
    "requiredParams": [
      "action",
      "reason",
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户加购因（无图、无产品id）而被拦截时"
  },
  {
    "id": "DOC-036",
    "kind": "exception",
    "name": "jjb_canvas_v3_cart_action_error",
    "requiredParams": [
      "action",
      "quantity",
      "variantId",
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户加购失败时"
  },
  {
    "id": "DOC-037",
    "kind": "business",
    "name": "jjb_canvas_v3_cart_action_start",
    "requiredParams": [
      "action",
      "quantity",
      "variantId",
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户正式进入加购流程时"
  },
  {
    "id": "DOC-038",
    "kind": "business",
    "name": "jjb_canvas_v3_cart_action_success",
    "requiredParams": [
      "action",
      "quantity",
      "variantId",
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户加购成功时"
  },
  {
    "id": "DOC-039",
    "kind": "exception",
    "name": "jjb_canvas_v3_cart_record_track_error",
    "requiredParams": [
      "action",
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "上报后端加购结果发生错误时"
  },
  {
    "id": "DOC-040",
    "kind": "business",
    "name": "jjb_canvas_v3_empty_hint_click",
    "requiredParams": [
      "action"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户点击上传图片弹窗时"
  },
  {
    "id": "DOC-041",
    "kind": "exception",
    "name": "jjb_canvas_v3_error_overlay_retry_click",
    "requiredParams": [
      "buttonText",
      "message",
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "2d、3d、模型加载 失败时"
  },
  {
    "id": "DOC-042",
    "kind": "exception",
    "name": "jjb_canvas_v3_experiment_error",
    "requiredParams": [
      "experiment"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "获取ab分组失败时"
  },
  {
    "id": "DOC-043",
    "kind": "exception",
    "name": "jjb_canvas_v3_fabric_load_error",
    "requiredParams": [
      "diy_module"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "pro画板加载失败时"
  },
  {
    "id": "DOC-044",
    "kind": "business",
    "name": "jjb_canvas_v3_fabric_loaded",
    "requiredParams": [],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "pro画板加载完成时"
  },
  {
    "id": "DOC-045",
    "kind": "business",
    "name": "jjb_canvas_v3_fabric_wait_for_load",
    "requiredParams": [
      "diy_module"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "pro画板开始加载时"
  },
  {
    "id": "DOC-046",
    "kind": "business",
    "name": "jjb_canvas_v3_figure_mode_switch",
    "requiredParams": [
      "figureMode",
      "previousFigureMode",
      "workflow"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户切换 单双 主体时"
  },
  {
    "id": "DOC-047",
    "kind": "exception",
    "name": "jjb_canvas_v3_ga4_callback_event_error",
    "requiredParams": [
      "eventName"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "异步ga4 上报失败时"
  },
  {
    "id": "DOC-048",
    "kind": "exception",
    "name": "jjb_canvas_v3_ga4_event_error",
    "requiredParams": [
      "eventName"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "同步ga4 上报失败时"
  },
  {
    "id": "DOC-049",
    "kind": "exception",
    "name": "jjb_canvas_v3_gaussian_splat_load_error",
    "requiredParams": [
      "modelUrl",
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "高斯模型加载失败时"
  },
  {
    "id": "DOC-050",
    "kind": "business",
    "name": "jjb_canvas_v3_gaussian_splat_load_success",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "高斯模型加载成功时"
  },
  {
    "id": "DOC-051",
    "kind": "business",
    "name": "jjb_canvas_v3_generate_2d_blocked",
    "requiredParams": [
      "dailyLimit",
      "imageGeneratingCount",
      "multipleImageLimit",
      "reason"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户开始生成因（次数上限、并发上限、缺少workflow、无图）而被拦截时触发"
  },
  {
    "id": "DOC-052",
    "kind": "exception",
    "name": "jjb_canvas_v3_generate_2d_error",
    "requiredParams": [
      "figureMode",
      "pendingId",
      "retry",
      "workflow"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "后端生成资产失败、连接中断、脚本异常 时"
  },
  {
    "id": "DOC-053",
    "kind": "exception",
    "name": "jjb_canvas_v3_generate_2d_export_error",
    "requiredParams": [
      "figureMode",
      "workflow"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户点击生成，画板导出图片失败时"
  },
  {
    "id": "DOC-054",
    "kind": "business",
    "name": "jjb_canvas_v3_generate_2d_retry_click",
    "requiredParams": [
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户点击2d retry 时"
  },
  {
    "id": "DOC-055",
    "kind": "business",
    "name": "jjb_canvas_v3_generate_2d_start",
    "requiredParams": [
      "canvasObjectCount",
      "figureMode",
      "flowVersion",
      "pendingId",
      "retry",
      "useSingleImage",
      "workflow"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户真实进入2d生成开始时"
  },
  {
    "id": "DOC-056",
    "kind": "business",
    "name": "jjb_canvas_v3_generate_2d_success",
    "requiredParams": [
      "figureMode",
      "hasImage",
      "pendingId",
      "recordId",
      "workflow"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "2d生成成功时"
  },
  {
    "id": "DOC-057",
    "kind": "business",
    "name": "jjb_canvas_v3_generate_3d_blocked",
    "requiredParams": [
      "hasImage",
      "reason",
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户生成3d因（无图、无资产id）被拦截时"
  },
  {
    "id": "DOC-058",
    "kind": "exception",
    "name": "jjb_canvas_v3_generate_3d_error",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "3d生成失败时"
  },
  {
    "id": "DOC-059",
    "kind": "business",
    "name": "jjb_canvas_v3_generate_3d_missing_model",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "3d重新生成失败（接口失败或资产无3d模型链接） 时"
  },
  {
    "id": "DOC-060",
    "kind": "business",
    "name": "jjb_canvas_v3_generate_3d_on_demand",
    "requiredParams": [
      "trigger",
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户点击3d tab 时，todo：几乎无用"
  },
  {
    "id": "DOC-061",
    "kind": "business",
    "name": "jjb_canvas_v3_generate_3d_retry_blocked",
    "requiredParams": [
      "reason",
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户重试3d因（无2d图）被拦截时"
  },
  {
    "id": "DOC-062",
    "kind": "business",
    "name": "jjb_canvas_v3_generate_3d_retry_click",
    "requiredParams": [
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户真实进入3d重试时"
  },
  {
    "id": "DOC-063",
    "kind": "business",
    "name": "jjb_canvas_v3_generate_3d_start",
    "requiredParams": [
      "hasImage",
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户真实开始3d重试时"
  },
  {
    "id": "DOC-064",
    "kind": "business",
    "name": "jjb_canvas_v3_generate_3d_success",
    "requiredParams": [
      "hasModel",
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "3d生成成功时"
  },
  {
    "id": "DOC-065",
    "kind": "business",
    "name": "jjb_canvas_v3_generate_poll_fallback",
    "requiredParams": [
      "fallback",
      "figureMode",
      "pendingId",
      "retry",
      "taskId",
      "workflow"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "sse回退到轮询时"
  },
  {
    "id": "DOC-066",
    "kind": "exception",
    "name": "jjb_canvas_v3_generate_s3_polling_flow_error",
    "requiredParams": [
      "clientTaskId",
      "workflow"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "全轮询失败时"
  },
  {
    "id": "DOC-067",
    "kind": "business",
    "name": "jjb_canvas_v3_history_delete_cancel",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户取消删除资产时"
  },
  {
    "id": "DOC-068",
    "kind": "business",
    "name": "jjb_canvas_v3_history_delete_click",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户点击删除资产按钮时"
  },
  {
    "id": "DOC-069",
    "kind": "business",
    "name": "jjb_canvas_v3_history_delete_confirm",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户确认删除资产时"
  },
  {
    "id": "DOC-070",
    "kind": "exception",
    "name": "jjb_canvas_v3_history_delete_error",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "后端删除资产失败"
  },
  {
    "id": "DOC-071",
    "kind": "business",
    "name": "jjb_canvas_v3_history_delete_start",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "开始请求后端删除资产"
  },
  {
    "id": "DOC-072",
    "kind": "business",
    "name": "jjb_canvas_v3_history_delete_success",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "后端删除资产成功"
  },
  {
    "id": "DOC-073",
    "kind": "business",
    "name": "jjb_canvas_v3_history_image_generated_3d_recovery",
    "requiredParams": [
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "历史记录中存在3d 生成中资产时"
  },
  {
    "id": "DOC-074",
    "kind": "exception",
    "name": "jjb_canvas_v3_history_image_generated_3d_recovery_error",
    "requiredParams": [
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "重试历史记录中3d资产失败时"
  },
  {
    "id": "DOC-075",
    "kind": "business",
    "name": "jjb_canvas_v3_history_load_more_blocked",
    "requiredParams": [
      "reason"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "无更多历史资产时"
  },
  {
    "id": "DOC-076",
    "kind": "exception",
    "name": "jjb_canvas_v3_history_load_more_error",
    "requiredParams": [
      "cursor"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "获取更多历史资产失败时"
  },
  {
    "id": "DOC-077",
    "kind": "business",
    "name": "jjb_canvas_v3_history_load_more_start",
    "requiredParams": [
      "cursor"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "加载更多历史资产开始时"
  },
  {
    "id": "DOC-078",
    "kind": "exception",
    "name": "jjb_canvas_v3_history_refresh_error",
    "requiredParams": [],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "更新历史记录失败时"
  },
  {
    "id": "DOC-079",
    "kind": "business",
    "name": "jjb_canvas_v3_history_refresh_success",
    "requiredParams": [
      "hasLatest",
      "hasMore",
      "loadedCount",
      "pageSize",
      "totalCount"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "更新历史记录成功时"
  },
  {
    "id": "DOC-080",
    "kind": "business",
    "name": "jjb_canvas_v3_history_select",
    "requiredParams": [
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户点击历史资产时"
  },
  {
    "id": "DOC-081",
    "kind": "exception",
    "name": "jjb_canvas_v3_history_thumbnail_error",
    "requiredParams": [
      "recordId",
      "recordStatus",
      "workflow"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "历史记录中渲染资产图片失败时"
  },
  {
    "id": "DOC-082",
    "kind": "business",
    "name": "jjb_canvas_v3_image_upload_compress_fallback",
    "requiredParams": [
      "fileName",
      "fileSize",
      "fileType",
      "reason"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "图片压缩失败时"
  },
  {
    "id": "DOC-083",
    "kind": "business",
    "name": "jjb_canvas_v3_image_upload_rejected",
    "requiredParams": [
      "fileName",
      "fileSize",
      "fileType",
      "reason"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "非法图片提交时"
  },
  {
    "id": "DOC-084",
    "kind": "business",
    "name": "jjb_canvas_v3_image_upload_selected",
    "requiredParams": [
      "fileName",
      "fileSize",
      "fileType"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户选择图片文件并进入上传流程时"
  },
  {
    "id": "DOC-085",
    "kind": "business",
    "name": "jjb_canvas_v3_invalid_image_try_another",
    "requiredParams": [
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户风控图片点击retry时"
  },
  {
    "id": "DOC-086",
    "kind": "exception",
    "name": "jjb_canvas_v3_lottie_load_error",
    "requiredParams": [
      "diy_module",
      "reason",
      "source"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "lottie加载失败时"
  },
  {
    "id": "DOC-087",
    "kind": "business",
    "name": "jjb_canvas_v3_main_tab_click",
    "requiredParams": [
      "historyCount",
      "targetView"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "切换 create、gallery 时"
  },
  {
    "id": "DOC-088",
    "kind": "exception",
    "name": "jjb_canvas_v3_membership_quota_load_error",
    "requiredParams": [],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "获取会员当日生成额度失败时"
  },
  {
    "id": "DOC-089",
    "kind": "business",
    "name": "jjb_canvas_v3_model_download_timing",
    "requiredParams": [
      "modelType",
      "recordId",
      "durationMs",
      "browserQueueMs",
      "ttfbMs",
      "totalDurationMs",
      "phase",
      "success",
      "transferSize",
      "cacheLikely",
      "timingMissing",
      "timingRestricted",
      "errorMessage"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "模型资源下载完成或失败后记录下载耗时时触发"
  },
  {
    "id": "DOC-090",
    "kind": "exception",
    "name": "jjb_canvas_v3_model_viewer_load_error",
    "requiredParams": [
      "modelUrl",
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "model-viewer 加载失败时"
  },
  {
    "id": "DOC-091",
    "kind": "business",
    "name": "jjb_canvas_v3_model_viewer_load_success",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "model-viewer 加载成功时"
  },
  {
    "id": "DOC-092",
    "kind": "exception",
    "name": "jjb_canvas_v3_model_viewer_parser_setup_error",
    "requiredParams": [
      "modelUrl",
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "model-viewer 加载插件失败时"
  },
  {
    "id": "DOC-093",
    "kind": "business",
    "name": "jjb_canvas_v3_paint_mode_set",
    "requiredParams": [
      "enabled"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户开启画笔模式时"
  },
  {
    "id": "DOC-094",
    "kind": "exception",
    "name": "jjb_canvas_v3_parse_price_error",
    "requiredParams": [
      "price"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "格式化产品价格失败时"
  },
  {
    "id": "DOC-095",
    "kind": "exception",
    "name": "jjb_canvas_v3_poll_record_error",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "回退轮询失败时"
  },
  {
    "id": "DOC-096",
    "kind": "exception",
    "name": "jjb_canvas_v3_poll_record_failed",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "回退轮询资产生成结果失败时"
  },
  {
    "id": "DOC-097",
    "kind": "business",
    "name": "jjb_canvas_v3_poll_record_image_completed",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "回退轮询资产2d生成成功时"
  },
  {
    "id": "DOC-098",
    "kind": "business",
    "name": "jjb_canvas_v3_poll_record_model_completed",
    "requiredParams": [
      "recordId"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "回退轮询资产3d生成成功时"
  },
  {
    "id": "DOC-099",
    "kind": "business",
    "name": "jjb_canvas_v3_preset_model_generate",
    "requiredParams": [
      "model",
      "workflow"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户选择预设模型并开始生成时"
  },
  {
    "id": "DOC-100",
    "kind": "exception",
    "name": "jjb_canvas_v3_preset_model_generate_error",
    "requiredParams": [
      "model",
      "pendingId",
      "workflow"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户选择预设模型生成失败时"
  },
  {
    "id": "DOC-101",
    "kind": "business",
    "name": "jjb_canvas_v3_preset_model_generate_success",
    "requiredParams": [
      "model",
      "recordId",
      "workflow"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户选择预设模型生成成功时"
  },
  {
    "id": "DOC-102",
    "kind": "business",
    "name": "jjb_canvas_v3_preset_model_select",
    "requiredParams": [
      "model",
      "workflow"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户选择预设模型时"
  },
  {
    "id": "DOC-103",
    "kind": "business",
    "name": "jjb_canvas_v3_refine_2d_apply",
    "requiredParams": [
      "drawingBoardMode",
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户点击 refine 按钮跳转到create时"
  },
  {
    "id": "DOC-104",
    "kind": "business",
    "name": "jjb_canvas_v3_refine_2d_blocked",
    "requiredParams": [
      "reason",
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户因（无图）点击refine被拦截时"
  },
  {
    "id": "DOC-105",
    "kind": "business",
    "name": "jjb_canvas_v3_refine_2d_click",
    "requiredParams": [
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户点击refine 按钮时"
  },
  {
    "id": "DOC-106",
    "kind": "business",
    "name": "jjb_canvas_v3_result_impression",
    "requiredParams": [
      "resultView",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode",
      "hasImage",
      "hasModel",
      "errorCode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "每次2d、3d资产曝光时"
  },
  {
    "id": "DOC-107",
    "kind": "business",
    "name": "jjb_canvas_v3_toolbar_click",
    "requiredParams": [
      "action",
      "nextEnabled",
      "canvasObjectCount",
      "disabled",
      "generateButtonExperimentGroup",
      "imageGeneratingCount"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户点击toolbar时"
  },
  {
    "id": "DOC-108",
    "kind": "business",
    "name": "jjb_canvas_v3_upgrade_button_mode_switch",
    "requiredParams": [
      "from",
      "to"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户切换画板模式时"
  },
  {
    "id": "DOC-109",
    "kind": "business",
    "name": "jjb_canvas_v3_uploaded_image_count",
    "requiredParams": [
      "imageCount",
      "mode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户开始生成时，记录pro模式用户上传到图片数量"
  },
  {
    "id": "DOC-110",
    "kind": "business",
    "name": "jjb_canvas_v3_view_switch",
    "requiredParams": [
      "targetView",
      "errorCode",
      "hasImage",
      "hasModel",
      "recordId",
      "recordStatus",
      "workflow",
      "figureMode"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "create、gallery tab切换时"
  },
  {
    "id": "DOC-111",
    "kind": "business",
    "name": "jjb_canvas_v3_workflow_impression",
    "requiredParams": [
      "workflow",
      "source"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "workflow曝光时"
  },
  {
    "id": "DOC-112",
    "kind": "business",
    "name": "jjb_canvas_v3_workflow_select",
    "requiredParams": [
      "previousWorkflow",
      "source",
      "workflow"
    ],
    "platforms": [
      "monitor"
    ],
    "actionDescription": "用户选择workflow 时"
  },
  {
    "id": "DOC-113",
    "kind": "business",
    "name": "campaign_banner_click",
    "requiredParams": [],
    "platforms": [
      "ga4"
    ],
    "actionDescription": "左右轮播板块点击轮播控件时"
  },
  {
    "id": "DOC-114",
    "kind": "business",
    "name": "campaign_banner_impression",
    "requiredParams": [],
    "platforms": [
      "ga4"
    ],
    "actionDescription": "左右轮播板块banner曝光时"
  },
  {
    "id": "DOC-115",
    "kind": "business",
    "name": "POD_Generate",
    "requiredParams": [],
    "platforms": [
      "ga4"
    ],
    "actionDescription": "用户点击生成按钮并开始生成流程时触发"
  },
  {
    "id": "DOC-116",
    "kind": "business",
    "name": "membership_plan_click",
    "requiredParams": [],
    "platforms": [
      "ga4",
      "monitor"
    ],
    "actionDescription": "用户点击会员卡片按钮时"
  },
  {
    "id": "DOC-117",
    "kind": "business",
    "name": "membership_plan_impression",
    "requiredParams": [],
    "platforms": [
      "ga4",
      "monitor"
    ],
    "actionDescription": "付费墙曝光时"
  },
  {
    "id": "DOC-118",
    "kind": "business",
    "name": "cart-info",
    "requiredParams": [
      "currency",
      "total_discount",
      "total_price",
      "items"
    ],
    "platforms": [
      "monitor"
    ],
    "forbiddenPlatforms": [
      "ga4",
      "statsig"
    ],
    "actionDescription": "购物车商品集合发生变化并结束防抖等待时"
  },
  {
    "id": "DOC-119",
    "kind": "business",
    "name": "promotion_popup_exposure",
    "requiredParams": [
      "popup_id",
      "experiment_group"
    ],
    "platforms": [
      "statsig"
    ],
    "actionDescription": "营销弹窗曝光时"
  }
] as const satisfies readonly TrackingCase[];

export const trackingCatalogSummary = {
  total: trackingCaseCatalog.length,
  business: trackingCaseCatalog.filter((item) => item.kind === 'business').length,
  exception: trackingCaseCatalog.filter((item) => item.kind === 'exception').length
} as const;
