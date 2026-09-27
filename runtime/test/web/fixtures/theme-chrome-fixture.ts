import { initTheme, selectLocalTheme, applyThemeFromEvent } from '../../../web/src/ui/theme';
import { applyTheme, resetTheme } from '../../../web/static/visual/frontend/src/utils/theme-importer';
import { WEB_THEME_PRESETS } from '../../../src/core/ui-theme-catalogue';
const skin = new URL(location.href).searchParams.get('skin') === 'visual' ? 'visual' : 'classic';
Object.assign(window, { themeChromeFixture: { start: () => initTheme({ skin }), select: selectLocalTheme, applyEvent: applyThemeFromEvent, import: applyTheme, reset: resetTheme, ids: WEB_THEME_PRESETS.map(p => p.id) } });
