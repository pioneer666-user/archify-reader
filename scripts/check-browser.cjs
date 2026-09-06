// Demo 专用浏览器检查（开发验证；需要 NODE_PATH 指向 Playwright，系统需有 Chrome）。
// 检查逻辑沿用 archify-reader 技能的 browser.cjs / evidence-browser.cjs，断言改为本样张内容。
const { chromium } = require('playwright');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');

(async () => {
  const manifestFile = path.resolve(process.argv[2]);
  const dir = path.dirname(manifestFile);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const file = path.resolve(dir, manifest.output);
  const raw = await readFile(path.resolve(dir, manifest.input));
  const derived = await readFile(file);
  const marker = derived.indexOf('\n<!-- Archify Reader v');
  assert.ok(marker > 0);
  assert.equal(derived.slice(0, marker).toString() + derived.slice(derived.lastIndexOf('</body>')).toString(), raw.toString());

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const checks = [];
  const errors = [];
  const page = await browser.newPage({ offline: true, viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  const url = (theme = 'light') => pathToFileURL(file).href + `?theme=${theme}`;
  const state = () => page.evaluate(() => {
    const svg = document.querySelector('.diagram-container svg[role="img"]');
    return { focus: svg.getAttribute('data-focus-active'), hash: location.hash,
      scale: document.querySelector('.diagram-container').getAttribute('style'),
      transform: svg.getAttribute('style'), scroll: [scrollX, scrollY] };
  });
  const nodeLocator = id => page.locator(`.diagram-container svg[role="img"] [data-node-id="${id}"]`);

  try {
    await page.goto(url());
    await page.waitForTimeout(700);

    // A. 逐节点：点击聚焦、详情内容、Escape 后原生状态逐字保留。
    //    点击前先清空上一次聚焦：原生“聚焦标签”会悬浮并拦截下一节点的指针事件。
    for (const node of manifest.nodes) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      await nodeLocator(node.id).click();
      await page.waitForTimeout(650);
      assert.ok((await page.locator('#sd-open').getAttribute('aria-label')).includes(node.label));
      const before = await state();
      await page.locator('#sd-open').click();
      assert.ok(await page.locator('#sd-dialog').evaluate(el => el.open));
      assert.equal(await page.locator('#sd-title').innerText(), node.label);
      assert.equal(await page.locator('#sd-note').innerText(), node.note);
      assert.ok(await page.locator('#sd-dialog').evaluate(el => el.classList.contains('sd-has-evidence')), `${node.id} 应为证据节点`);
      assert.ok((await page.locator('#sd-content').innerText()).length > 60);
      await page.keyboard.press('Escape');
      assert.ok(!await page.locator('#sd-dialog').evaluate(el => el.open));
      assert.deepEqual(await state(), before, `关闭详情改变了 ${node.id} 的原生状态`);
    }
    checks.push(`${manifest.nodes.length} 个节点详情正确（含证据模式），Escape 保留聚焦、地址、相机与滚动`);

    // B. 悬停注释出现与消失，并留存浅色截图。
    await page.mouse.move(10, 890);
    await nodeLocator('submit_registration').hover();
    await page.locator('#sd-tip').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#sd-tip').innerText()).includes('sign-up'));
    await page.screenshot({ path: path.join(dir, 'reader-hover.light.png') });
    await page.mouse.move(10, 890);
    await page.locator('#sd-tip').waitFor({ state: 'hidden' });
    checks.push('节点悬停注释出现并消失');

    // C. 键盘聚焦后原生 Enter 选中。
    await nodeLocator('check_eligibility').focus();
    await page.locator('#sd-tip').waitFor({ state: 'visible' });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(650);
    assert.ok((await page.locator('#sd-open').getAttribute('aria-label')).includes('Check Eligibility'));
    checks.push('键盘聚焦注释与原生 Enter 选中');

    // D. 面板内下拉切换节点，关闭按钮保留图上选中节点。
    await page.locator('#sd-open').click();
    await page.locator('#sd-select').selectOption('waitlist_entry');
    assert.equal(await page.locator('#sd-title').innerText(), 'Add to Waitlist');
    assert.ok((await page.locator('#sd-content').innerText()).includes('waiting-list'));
    await page.screenshot({ path: path.join(dir, 'reader-detail.light.png') });
    await page.locator('#sd-close').click();
    assert.ok((await page.locator('#sd-open').getAttribute('aria-label')).includes('Check Eligibility'));
    checks.push('面板内切换章节后关闭按钮保留图上选中节点');

    // E. 原生搜索仍然可用并联动详情入口。
    await page.keyboard.press('Escape');
    await page.keyboard.press('/');
    await page.locator('#node-finder-input').fill('create_record');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(650);
    assert.ok((await page.locator('#sd-open').getAttribute('aria-label')).includes('Create Registration'));
    checks.push('原生搜索聚焦正确节点并联动详情入口');

    // F. 原生缩放与拖拽平移保持可用（从图中心拖拽，避免落在图外空白处）。
    await page.keyboard.press('Escape');
    const panSurface = page.locator('.diagram-container svg[role="img"]');
    await page.locator('[data-view="in"]').click();
    await page.waitForTimeout(650);
    const beforeDrag = await panSurface.getAttribute('style');
    const box = await panSurface.boundingBox();
    // 在 SVG 内找一块非节点、非卡片的空白处作为拖拽起点（中心点常落在节点上，拖节点不平移）。
    const blank = await page.evaluate(([bx, by, bw, bh]) => {
      const describe = el => { let cur = el; while (cur) { if (String(cur.id || '').startsWith('node-')) return false; cur = cur.parentElement; } return true; };
      for (const [fx, fy] of [[0.2, 0.15], [0.8, 0.2], [0.5, 0.85], [0.15, 0.5], [0.85, 0.5], [0.5, 0.08]]) {
        const x = bx + bw * fx, y = by + bh * fy;
        const el = document.elementFromPoint(x, y);
        if (el && describe(el)) return [x, y];
      }
      return null;
    }, [box.x, box.y, box.width, box.height]);
    assert.ok(blank, '找不到可平移的空白区域');
    await page.mouse.move(blank[0], blank[1]); await page.mouse.down(); await page.mouse.move(blank[0] + 80, blank[1] + 30, { steps: 8 }); await page.mouse.up();
    assert.notEqual(await panSurface.getAttribute('style'), beforeDrag, '原生拖拽必须仍能平移');
    checks.push('原生缩放与拖拽平移保持可用');

    // G. 三种视口：原图宽度不受增强影响、详情不溢出、证据两栏/堆叠正确。
    const target = manifest.nodes.find(node => node.id === 'create_record');
    for (const [width, height, theme] of [[1440, 900, 'light'], [2082, 1315, 'dark'], [390, 844, 'light']]) {
      await page.setViewportSize({ width, height });
      const graphSizes = [];
      for (const candidate of [path.resolve(dir, manifest.input), file]) {
        await page.goto(pathToFileURL(candidate).href + `?theme=${theme}`);
        await page.waitForTimeout(700);
        graphSizes.push(await page.locator('.diagram-container svg[role="img"]').evaluate(el => el.getBoundingClientRect().width));
      }
      assert.ok(Math.abs(graphSizes[0] - graphSizes[1]) < 1);
      await nodeLocator(target.id).click();
      await page.locator('#sd-open').click();
      const layout = await page.evaluate(() => {
        const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const scroller = document.getElementById('sd-scroll');
        return { dialog: rect(document.getElementById('sd-dialog')), fits: scroller.scrollWidth <= scroller.clientWidth + 1,
          pairs: [...document.querySelectorAll('.sd-evidence-pair')].map(el => ({ code: rect(el.querySelector('.sd-evidence-code')), prose: rect(el.querySelector('.sd-evidence-prose')) })) };
      });
      assert.ok(layout.fits && layout.dialog.left >= 0 && layout.dialog.right <= width && layout.dialog.bottom <= height);
      assert.equal(layout.pairs.length, target.evidence.length);
      for (const pair of layout.pairs) {
        if (width > 850) assert.ok(pair.code.right < pair.prose.left && Math.abs(pair.code.top - pair.prose.top) < 1);
        else assert.ok(pair.prose.top > pair.code.bottom);
      }
      const imageName = width === 390 ? 'evidence-detail.mobile.png' : `evidence-detail.${theme}.png`;
      await page.screenshot({ path: path.join(dir, imageName) });
      checks.push(`视口 ${width}x${height} ${theme}：原图宽度一致、详情不溢出、证据配对布局正确`);
    }

    // H. 三视口下验证引用跳转；返回恢复段落位置与键盘焦点，原图状态不变。
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url()); await page.waitForTimeout(700);
    for (const nodeId of ['create_record', 'send_confirmation']) {
      const node = manifest.nodes.find(item => item.id === nodeId);
      await page.locator('[data-view="reset"]').click(); await page.waitForTimeout(600);
      await nodeLocator(nodeId).click(); await page.waitForTimeout(650);
      await page.locator('#sd-open').click();
      for (const reference of node.references || []) {
        const button = page.locator(`.sd-node-reference[data-sd-target="${reference.target}"]`).first();
        await button.scrollIntoViewIfNeeded();
        await button.focus();
        const beforeGraph = await state();
        const beforeScroll = await page.locator('#sd-scroll').evaluate(el => el.scrollTop);
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#sd-select').inputValue(), reference.target);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'sd-title');
        await page.locator('#sd-back').click();
        assert.equal(await page.locator('#sd-select').inputValue(), nodeId);
        assert.ok(Math.abs(await page.locator('#sd-scroll').evaluate(el => el.scrollTop) - beforeScroll) < 1);
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-sd-target')), reference.target);
        assert.deepEqual(await state(), beforeGraph);
        assert.ok(await page.locator('#sd-back').isHidden());
      }
      await page.keyboard.press('Escape');
    }
    checks.push('节点引用跳转与返回：恢复阅读位置和焦点，原图状态不变');

    // I. 每个证据节点：页面代码块与固定 Git 版本逐字一致。
    await page.goto(url()); await page.waitForTimeout(700);
    let compared = 0;
    for (const node of manifest.nodes) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      await nodeLocator(node.id).click(); await page.waitForTimeout(650);
      await page.locator('#sd-open').click();
      const rendered = await page.locator('.sd-snippet pre code').allTextContents();
      const order = await page.locator('.sd-evidence-pair').evaluateAll(els => els.map(el => el.getAttribute('aria-label')));
      const specs = order.flatMap(heading => node.evidence.find(pair => pair.heading === heading).snippets);
      assert.equal(rendered.length, specs.length);
      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        const source = execFileSync('git', ['--no-replace-objects', '-C', path.resolve(dir, manifest.codeSource.repository), 'show', `${manifest.codeSource.commit}:${spec.file}`], { encoding: 'utf8', windowsHide: true });
        const expected = source.split('\n').slice(spec.startLine - 1, spec.endLine).join('\n').replace(/\r\n/g, '\n');
        assert.equal(rendered[i].replace(/\r\n/g, '\n'), expected);
        compared += 1;
      }
      await page.keyboard.press('Escape');
    }
    checks.push(`页面 ${compared} 个源码块与固定 Git 版本（${manifest.codeSource.commit.slice(0, 8)}）逐字一致`);

    assert.deepEqual(errors, []);
    const evidence = {
      file: path.basename(file), sha256: createHash('sha256').update(derived).digest('hex'),
      browser: `Chrome ${browser.version()}`, checkedAt: new Date().toISOString(), status: 'passed',
      checks, pageErrors: errors, visualReview: 'not_recorded_by_automation', businessVerification: 'not_run'
    };
    await writeFile(path.join(dir, 'reader.browser-check.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
