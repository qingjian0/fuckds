import fs from 'node:fs';

import { DeepSeekWeb } from './browser/driver.mjs';
import { DirectEngine } from './direct/client.mjs';

/**
 * 选择引擎（默认 direct）：
 *   ENGINE=direct  只直连（需要 bin/ds-pow）；条件不满足直接抛错
 *   ENGINE=browser 只走 Playwright（驱动真实网页，不依赖 PoW 求解器）
 *   ENGINE=auto    有 Go 求解器就直连，否则回退浏览器
 */
export function createEngine({ config, logger }) {
  // 未显式指定时默认 direct
  const engine = config.engine ?? 'direct';

  const wantDirect = engine !== 'browser';
  const binExists = fs.existsSync(config.direct.powBin);
  const androidWasmExists = Boolean(process.versions.mobile) &&
    fs.existsSync(new URL('../bin/ds-pow.wasm', import.meta.url));
  const canDirect = (binExists || androidWasmExists) && Boolean(config.deepseek.token);

  if (wantDirect && canDirect) {
    return new DirectEngine({ config, logger: logger.child('direct') });
  }

  if (engine === 'direct') {
    throw new Error(
      `ENGINE=direct 但条件不满足：powBin=${config.direct.powBin}（存在=${binExists}），Android WASM=${androidWasmExists}，token=${Boolean(config.deepseek.token)}。先构建 PoW 并配置账号`,
    );
  }
  if (wantDirect) {
    logger.warn('没有可用的 PoW 求解器，回退到 Playwright 引擎');
  }
  return new DeepSeekWeb({ config, logger: logger.child('web') });
}