import { EventExpectation } from './tracking-collector.js';

export const trackingContracts = {
  diyViewGa4: {
    name: 'POD_diy_view',
    platform: 'ga4',
    requiredParams: { entry_page: /.+/ }
  },
  diyViewStatsig: {
    name: 'POD_diy_view',
    platform: 'statsig',
    requiredParams: { entry_page: /.+/ }
  },
  workflowImpressionMonitor: {
    name: 'jjb_canvas_v3_workflow_impression',
    platform: 'monitor',
    requiredParams: { source: 'initial', workflow: /.+/ }
  },
  albumClickGa4: { name: 'POD_Canvas_Album_Click', platform: 'ga4' },
  albumHintMonitor: {
    name: 'jjb_canvas_v3_empty_hint_click',
    platform: 'monitor',
    requiredParams: { action: /.+/ }
  },
  imageUploadSelectedMonitor: {
    name: 'jjb_canvas_v3_image_upload_selected',
    platform: 'monitor',
    requiredParams: { fileName: /.+/, fileSize: /.+/, fileType: /^image\// }
  },
  upgradeClickGa4: {
    name: 'POD_Canvas_Upgrade_Click',
    platform: 'ga4',
    requiredParams: { mode: 'basic' }
  },
  modeSelectionGa4: {
    name: 'click_basic_or_pro',
    platform: 'ga4',
    requiredParams: { mode: 'pro' }
  },
  modeSelectionStatsig: {
    name: 'click_basic_or_pro',
    platform: 'statsig',
    requiredParams: { mode: 'pro' }
  },
  upgradeModeSwitchMonitor: {
    name: 'jjb_canvas_v3_upgrade_button_mode_switch',
    platform: 'monitor',
    requiredParams: { from: 'basic', to: 'pro' }
  },
  figureModeSwitchGa4: {
    name: 'POD_FigureMode_Switch',
    platform: 'ga4',
    requiredParams: { figure_mode: /.+/ }
  },
  figureModeSwitchMonitor: {
    name: 'jjb_canvas_v3_figure_mode_switch',
    platform: 'monitor',
    requiredParams: { figureMode: /.+/, previousFigureMode: /.+/, workflow: /.+/ }
  },
  promptClickGa4: { name: 'POD_Canvas_Text_Click', platform: 'ga4' },
  promptClickStatsig: { name: 'POD_Canvas_Text_Click', platform: 'statsig' },
  textToolbarMonitor: {
    name: 'jjb_canvas_v3_toolbar_click',
    platform: 'monitor',
    requiredParams: { action: 'text' }
  },
  generateClickGa4: { name: 'POD_Canvas_Generate_Click', platform: 'ga4' },
  generateClickStatsig: { name: 'POD_Canvas_Generate_Click', platform: 'statsig' },
  generateToolbarMonitor: {
    name: 'jjb_canvas_v3_toolbar_click',
    platform: 'monitor',
    requiredParams: { action: 'generate', disabled: false }
  },
  generateStartGa4: {
    name: 'POD_Generate_Start',
    platform: 'ga4',
    requiredParams: {
      style_type: /.+/,
      figure_mode: /.+/,
      input_type: 'DIY',
      generate_flow_version: /.+/
    }
  },
  generateTwoDStartMonitor: {
    name: 'jjb_canvas_v3_generate_2d_start',
    platform: 'monitor',
    requiredParams: {
      canvasObjectCount: /.+/,
      figureMode: /.+/,
      flowVersion: /.+/,
      pendingId: /.+/,
      retry: false,
      useSingleImage: /^(?:true|false)$/,
      workflow: /.+/
    }
  },
  generateSuccessGa4: {
    name: 'POD_Generate_success',
    platform: 'ga4',
    requiredParams: { style_type: /.+/, figure_mode: /.+/, record_id: /.+/ },
    eventTimeoutMs: 300_000
  },
  generateSuccessStatsig: {
    name: 'POD_Generate_success',
    platform: 'statsig',
    requiredParams: { style_type: /.+/, figure_mode: /.+/, record_id: /.+/ },
    eventTimeoutMs: 300_000
  },
  generateTwoDSuccessMonitor: {
    name: 'jjb_canvas_v3_generate_2d_success',
    platform: 'monitor',
    requiredParams: {
      figureMode: /.+/,
      hasImage: true,
      pendingId: /.+/,
      recordId: /.+/,
      workflow: /.+/
    },
    eventTimeoutMs: 300_000
  },
  twoDImpressionGa4: {
    name: 'diy_2D_impression',
    platform: 'ga4',
    requiredParams: { template_id: /.+/ },
    eventTimeoutMs: 300_000
  },
  twoDImpressionStatsig: {
    name: 'diy_2D_impression',
    platform: 'statsig',
    requiredParams: { template_id: /.+/ },
    eventTimeoutMs: 300_000
  },
  twoDResultImpressionMonitor: {
    name: 'jjb_canvas_v3_result_impression',
    platform: 'monitor',
    requiredParams: {
      resultView: '2d',
      recordId: /.+/,
      recordStatus: /.+/,
      workflow: /.+/,
      figureMode: /.+/,
      hasImage: true,
      hasModel: false
    },
    eventTimeoutMs: 300_000
  },
  galleryViewGa4: { name: 'POD_Gallery_View', platform: 'ga4' },
  galleryViewStatsig: { name: 'POD_Gallery_View', platform: 'statsig' },
  galleryTabMonitor: {
    name: 'jjb_canvas_v3_main_tab_click',
    platform: 'monitor',
    requiredParams: { historyCount: /.+/, targetView: 'gallery' }
  },
  threeDViewSwitchMonitor: {
    name: 'jjb_canvas_v3_view_switch',
    platform: 'monitor',
    requiredParams: { targetView: '3d', recordId: /.+/, workflow: /.+/, figureMode: /.+/ }
  },
  threeDImpressionGa4: {
    name: 'diy_3D_impression',
    platform: 'ga4',
    requiredParams: { template_id: /.+/ },
    eventTimeoutMs: 300_000
  },
  threeDImpressionStatsig: {
    name: 'diy_3D_impression',
    platform: 'statsig',
    requiredParams: { template_id: /.+/ },
    eventTimeoutMs: 300_000
  },
  threeDResultImpressionMonitor: {
    name: 'jjb_canvas_v3_result_impression',
    platform: 'monitor',
    requiredParams: {
      resultView: '3d',
      recordId: /.+/,
      recordStatus: /.+/,
      workflow: /.+/,
      figureMode: /.+/,
      hasImage: true,
      hasModel: true
    },
    eventTimeoutMs: 300_000
  }
} as const satisfies Record<string, EventExpectation>;
