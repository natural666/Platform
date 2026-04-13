// ==UserScript==
// @name         采销价格收录助手
// @namespace    jd-caixin-tools
// @version      1.0
// @description  在京东/天猫/苏宁/拼多多商品页自动识别价格，一键收录，批量导出到价格雷达
// @author       采销工具集
// @match        *://item.jd.com/*
// @match        *://item.m.jd.com/*
// @match        *://detail.tmall.com/*
// @match        *://detail.tmall.hk/*
// @match        *://item.taobao.com/*
// @match        *://product.suning.com/*
// @match        *://mobile.yangkeduo.com/*
// @match        *://www.yangkeduo.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  // ==========================================
  //  一、平台检测与价格提取
  // ==========================================

  function detectPlatform() {
    const host = location.hostname;
    if (host.includes('jd.com')) return 'jd';
    if (host.includes('tmall.com') || host.includes('tmall.hk')) return 'tmall';
    if (host.includes('taobao.com')) return 'tmall';  // 归为天猫
    if (host.includes('suning.com')) return 'suning';
    if (host.includes('yangkeduo.com')) return 'pdd';
    return 'other';
  }

  const PLATFORM = detectPlatform();
  const PF_NAMES = { jd: '京东', tmall: '天猫', suning: '苏宁', pdd: '拼多多', other: '其他' };
  const PF_COLORS = { jd: '#E4393C', tmall: '#FF6A00', suning: '#D4900A', pdd: '#E02E24', other: '#666' };

  // 从URL中提取商品ID
  function extractId() {
    const path = location.pathname + location.search;
    // 京东：item.jd.com/100038374856.html
    let m = path.match(/\/(\d{6,15})\.html/);
    if (m) return m[1];
    // 天猫/淘宝：id=xxx
    m = location.search.match(/[?&]id=(\d+)/);
    if (m) return m[1];
    // 苏宁：product.suning.com/0070xxx/100038374856.html
    m = path.match(/\/(\d{6,15})\.html/);
    if (m) return m[1];
    // 拼多多：goods_id=xxx
    m = location.search.match(/goods_id=(\d+)/);
    if (m) return m[1];
    return '';
  }

  // 尝试多个选择器，返回第一个有效值
  function trySelectors(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.textContent.trim();
          if (text) return text;
        }
      } catch {}
    }
    return '';
  }

  // 从文本中提取数字价格
  function parsePrice(text) {
    if (!text) return 0;
    const m = text.replace(/,/g, '').match(/([\d]+\.?\d*)/);
    return m ? parseFloat(m[1]) : 0;
  }

  // 各平台价格提取选择器（按优先级排列，兼容页面改版）
  const PRICE_SELECTORS = {
    jd: [
      '.p-price .price',
      '.p-price span:last-child',
      '.price-plus .p-price .price',
      '[class*="Price_mainPrice"] [class*="Price_Price"]',
      '.summary-price-wrap .summary-price',
      '.itemInfo-wrap .price',
    ],
    tmall: [
      '.tm-price',
      '.tm-promo-price .tm-price',
      '[class*="Price--current"]',
      '[class*="price--current"]',
      '.tb-rmb-num',
      '#J_StrPriceModBox .tb-rmb-num',
      '[class*="originPrice"] [class*="priceText"]',
    ],
    suning: [
      '.mainprice .sale-price',
      '#itemDisplayPrice',
      '.price .p-price',
      '.price-main .mainprice',
    ],
    pdd: [
      '[class*="price"] [class*="num"]',
      '.price-num',
      '[class*="Price"] [class*="price"]',
    ],
  };

  const TITLE_SELECTORS = {
    jd: ['.sku-name', '.itemInfo-wrap .sku-name', '.product-intro .sku-name', 'h1'],
    tmall: ['.tb-main-title', '[class*="ItemHeader--mainTitle"]', '[class*="title--text"]', 'h1'],
    suning: ['.itemInfo-wrap h1', '#itemDisplayName', '.product-name h1'],
    pdd: ['.goods-name', '[class*="goodsName"]', 'h1'],
  };

  // 提取当前页面信息（支持重试，因为很多页面价格是异步加载的）
  function extractPageInfo() {
    const selectors = PRICE_SELECTORS[PLATFORM] || [];
    const titleSels = TITLE_SELECTORS[PLATFORM] || ['h1', 'title'];

    const priceText = trySelectors(selectors);
    const price = parsePrice(priceText);
    const title = trySelectors(titleSels).replace(/\s+/g, ' ').slice(0, 80);
    const itemId = extractId();

    return { platform: PLATFORM, price, title, itemId, url: location.href };
  }

  // ==========================================
  //  二、数据存储（Tampermonkey GM存储，跨页面共享）
  // ==========================================

  const STORE_KEY = 'price_collector_data';

  function loadData() {
    try { return JSON.parse(GM_getValue(STORE_KEY, '[]')); }
    catch { return []; }
  }

  function saveData(data) {
    GM_setValue(STORE_KEY, JSON.stringify(data));
  }

  // 收录一条价格
  function recordPrice(info) {
    const data = loadData();
    // 查找是否已有相同平台+SKU编码的记录
    const existing = data.find(d => d.platform === info.platform && d.skuCode === info.skuCode && d.skuCode);
    if (existing) {
      // 更新
      existing.price = info.price;
      existing.title = info.title || existing.title;
      existing.url = info.url;
      existing.time = new Date().toLocaleString();
    } else {
      data.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        platform: info.platform,
        skuCode: info.skuCode || '',
        skuName: info.skuName || '',
        title: info.title,
        price: info.price,
        coupon: info.coupon || 0,
        couponDetail: info.couponDetail || '',
        url: info.url,
        time: new Date().toLocaleString(),
      });
    }
    saveData(data);
    return data;
  }

  function deleteRecord(id) {
    const data = loadData().filter(d => d.id !== id);
    saveData(data);
    return data;
  }

  function clearAll() {
    saveData([]);
    return [];
  }

  // 导出为价格雷达兼容格式
  function exportJSON() {
    const data = loadData();
    if (!data.length) { alert('还没有收录任何价格'); return; }

    // 按SKU编码分组
    const groups = {};
    data.forEach(d => {
      const key = d.skuCode || `_unnamed_${d.id}`;
      if (!groups[key]) {
        groups[key] = { code: d.skuCode || '', name: d.skuName || d.title || '', platforms: [] };
      }
      groups[key].platforms.push({
        platform: d.platform,
        title: d.title,
        url: d.url,
        price: d.price,
        coupon: d.coupon || 0,
      });
    });

    const output = {
      crawl_time: new Date().toLocaleString(),
      source: '浏览器插件收录',
      results: Object.values(groups),
    };

    // 下载JSON文件
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'crawler_results.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ==========================================
  //  三、浮窗UI
  // ==========================================

  GM_addStyle(`
    #cx-price-panel{position:fixed;bottom:20px;right:20px;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;font-size:13px;color:#1B1F3B;line-height:1.5;user-select:none}
    #cx-price-panel *{box-sizing:border-box;margin:0;padding:0}
    .cx-panel-main{background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.18);border:1px solid #E5E7EB;width:320px;overflow:hidden;transition:all .25s}
    .cx-panel-main.collapsed{width:auto;border-radius:28px}
    .cx-header{display:flex;align-items:center;gap:8px;padding:12px 16px;background:linear-gradient(135deg,#534AB7,#7C3AED);color:#fff;cursor:move}
    .cx-header-title{flex:1;font-size:14px;font-weight:600}
    .cx-header-badge{background:rgba(255,255,255,.25);padding:1px 8px;border-radius:10px;font-size:11px;font-weight:700}
    .cx-header-toggle{background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:2px 6px;border-radius:6px}
    .cx-header-toggle:hover{background:rgba(255,255,255,.2)}
    .cx-body{padding:14px 16px;max-height:420px;overflow-y:auto}
    .cx-section{margin-bottom:14px}
    .cx-section:last-child{margin-bottom:0}
    .cx-label{font-size:11px;color:#6B7280;font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
    .cx-detected{background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px 14px}
    .cx-detected.empty{background:#FEF2F2;border-color:#FECACA}
    .cx-det-platform{font-size:12px;font-weight:700;margin-bottom:4px}
    .cx-det-title{font-size:12px;color:#6B7280;margin-bottom:6px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .cx-det-price{font-size:22px;font-weight:800;color:#E4393C}
    .cx-det-noprice{font-size:14px;color:#DC2626;font-weight:600}
    .cx-input-row{display:flex;gap:6px;margin-top:8px}
    .cx-input{flex:1;padding:7px 10px;border:1.5px solid #E5E7EB;border-radius:8px;font-size:12px;outline:none;font-family:inherit}
    .cx-input:focus{border-color:#534AB7}
    .cx-input::placeholder{color:#9CA3AF}
    .cx-btn{padding:8px 16px;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s}
    .cx-btn:active{transform:scale(.97)}
    .cx-btn-primary{background:#534AB7;color:#fff}.cx-btn-primary:hover{background:#4338CA}
    .cx-btn-primary:disabled{background:#D1D5DB;cursor:default}
    .cx-btn-export{background:#DCFCE7;color:#166534}.cx-btn-export:hover{background:#BBF7D0}
    .cx-btn-sm{padding:4px 10px;font-size:11px;border-radius:6px}
    .cx-btn-danger{background:#FEE2E2;color:#DC2626;font-size:11px;padding:3px 8px;border-radius:6px}
    .cx-btn-danger:hover{background:#FECACA}
    .cx-record-list{max-height:200px;overflow-y:auto}
    .cx-record{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#F9FAFB;border-radius:8px;margin-bottom:6px;font-size:12px}
    .cx-record:last-child{margin-bottom:0}
    .cx-rec-pf{font-weight:700;font-size:11px;padding:2px 6px;border-radius:4px;color:#fff;flex-shrink:0}
    .cx-rec-info{flex:1;min-width:0;overflow:hidden}
    .cx-rec-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cx-rec-meta{color:#9CA3AF;font-size:10px}
    .cx-rec-price{font-weight:700;color:#E4393C;flex-shrink:0;font-size:14px}
    .cx-footer{padding:10px 16px;border-top:1px solid #F3F4F6;display:flex;gap:8px}
    .cx-toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1B1F3B;color:#fff;padding:10px 24px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999999;animation:cxFadeIn .3s}
    @keyframes cxFadeIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    .cx-collapsed-btn{display:flex;align-items:center;gap:8px;padding:10px 18px;background:linear-gradient(135deg,#534AB7,#7C3AED);color:#fff;border-radius:28px;cursor:pointer;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(83,74,183,.35)}
    .cx-collapsed-btn:hover{box-shadow:0 6px 24px rgba(83,74,183,.45)}
    .cx-coupon-row{display:flex;gap:6px;margin-top:6px}
  `);

  // 创建浮窗
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'cx-price-panel';
    document.body.appendChild(panel);

    let collapsed = false;
    let showList = false;

    function render() {
      const info = extractPageInfo();
      const allData = loadData();
      const count = allData.length;
      const pfColor = PF_COLORS[PLATFORM] || '#666';
      const pfName = PF_NAMES[PLATFORM] || '未知平台';

      if (collapsed) {
        panel.innerHTML = `
          <div class="cx-collapsed-btn" id="cx-expand">
            📡 价格助手 ${count > 0 ? `<span style="background:rgba(255,255,255,.25);padding:1px 8px;border-radius:10px;font-size:11px">${count}</span>` : ''}
          </div>`;
        panel.querySelector('#cx-expand').onclick = () => { collapsed = false; render(); };
        return;
      }

      let listHTML = '';
      if (showList) {
        if (allData.length === 0) {
          listHTML = '<div style="text-align:center;padding:16px;color:#9CA3AF;font-size:12px">还没有收录任何价格<br/>打开商品页后点「收录」</div>';
        } else {
          listHTML = '<div class="cx-record-list">';
          allData.forEach(d => {
            const bg = PF_COLORS[d.platform] || '#666';
            const name = PF_NAMES[d.platform] || d.platform;
            listHTML += `
              <div class="cx-record">
                <span class="cx-rec-pf" style="background:${bg}">${name}</span>
                <div class="cx-rec-info">
                  <div class="cx-rec-name">${d.skuCode ? '[' + d.skuCode + '] ' : ''}${d.skuName || d.title}</div>
                  <div class="cx-rec-meta">${d.time}</div>
                </div>
                <span class="cx-rec-price">¥${d.price.toLocaleString()}</span>
                <button class="cx-btn-danger cx-del-btn" data-id="${d.id}">删</button>
              </div>`;
          });
          listHTML += '</div>';
        }
      }

      const hasPrice = info.price > 0;

      panel.innerHTML = `
        <div class="cx-panel-main">
          <div class="cx-header" id="cx-drag">
            <span class="cx-header-title">📡 采销价格助手</span>
            ${count > 0 ? `<span class="cx-header-badge">${count}条</span>` : ''}
            <button class="cx-header-toggle" id="cx-collapse" title="收起">−</button>
          </div>
          <div class="cx-body">
            <div class="cx-section">
              <div class="cx-label">当前页面检测</div>
              <div class="cx-detected ${hasPrice ? '' : 'empty'}">
                <div class="cx-det-platform" style="color:${pfColor}">${pfName}${info.itemId ? ' · ' + info.itemId : ''}</div>
                <div class="cx-det-title">${info.title || '（未识别到标题）'}</div>
                ${hasPrice
                  ? `<div class="cx-det-price">¥${info.price.toLocaleString()}</div>`
                  : `<div class="cx-det-noprice">⚠ 未检测到价格（页面可能还在加载，等几秒点「刷新」）</div>`
                }
              </div>
            </div>

            ${hasPrice ? `
            <div class="cx-section">
              <div class="cx-label">收录到哪个SKU（填编码方便匹配价格雷达）</div>
              <div class="cx-input-row">
                <input class="cx-input" id="cx-sku-code" placeholder="SKU编码 如100038374856" value="${info.itemId && PLATFORM === 'jd' ? info.itemId : ''}"/>
              </div>
              <div class="cx-input-row">
                <input class="cx-input" id="cx-sku-name" placeholder="SKU名称 如MAXHUB V7 75寸（选填）" value=""/>
              </div>
              <div class="cx-coupon-row">
                <input class="cx-input" id="cx-coupon" type="number" placeholder="优惠金额(元)" style="width:90px;flex:none" value="0"/>
                <input class="cx-input" id="cx-coupon-detail" placeholder="优惠说明 如满减/券" value=""/>
              </div>
              <div style="margin-top:8px;display:flex;gap:8px">
                <button class="cx-btn cx-btn-primary" id="cx-record" style="flex:1">✅ 收录此价格</button>
                <button class="cx-btn cx-btn-sm" id="cx-refresh" style="background:#F3F4F6;color:#6B7280">🔄 刷新</button>
              </div>
            </div>
            ` : `
            <div style="margin-top:8px;text-align:center">
              <button class="cx-btn cx-btn-sm" id="cx-refresh" style="background:#F3F4F6;color:#6B7280">🔄 重新检测价格</button>
            </div>
            `}

            <div class="cx-section" style="margin-top:12px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span class="cx-label" style="margin:0;flex:1">已收录 (${count})</span>
                <button class="cx-btn cx-btn-sm" id="cx-toggle-list" style="background:#EEEDFE;color:#534AB7">${showList ? '收起' : '展开'}</button>
              </div>
              ${listHTML}
            </div>
          </div>

          <div class="cx-footer">
            <button class="cx-btn cx-btn-export" id="cx-export" style="flex:1" ${count === 0 ? 'disabled' : ''}>📥 导出JSON (${count})</button>
            ${count > 0 ? `<button class="cx-btn cx-btn-danger" id="cx-clear">清空</button>` : ''}
          </div>
        </div>`;

      // 绑定事件
      panel.querySelector('#cx-collapse').onclick = () => { collapsed = true; render(); };
      panel.querySelector('#cx-toggle-list')?.addEventListener('click', () => { showList = !showList; render(); });
      panel.querySelector('#cx-export')?.addEventListener('click', exportJSON);
      panel.querySelector('#cx-clear')?.addEventListener('click', () => {
        if (confirm('确定清空所有已收录的价格？')) { clearAll(); render(); toast('已清空'); }
      });
      panel.querySelector('#cx-refresh')?.addEventListener('click', () => { render(); toast('已刷新'); });

      // 收录按钮
      panel.querySelector('#cx-record')?.addEventListener('click', () => {
        const code = panel.querySelector('#cx-sku-code').value.trim();
        const name = panel.querySelector('#cx-sku-name').value.trim();
        const coupon = parseFloat(panel.querySelector('#cx-coupon').value) || 0;
        const couponDetail = panel.querySelector('#cx-coupon-detail').value.trim();

        if (!code) {
          if (!confirm('没填SKU编码，导入时可能匹配不上价格雷达的监控。\n确定继续？')) return;
        }

        recordPrice({
          platform: info.platform,
          skuCode: code,
          skuName: name,
          title: info.title,
          price: info.price,
          coupon: coupon,
          couponDetail: couponDetail,
          url: info.url,
        });
        render();
        toast(`收录成功 ¥${info.price}` + (coupon > 0 ? ` (优惠-${coupon})` : ''));
      });

      // 删除按钮
      panel.querySelectorAll('.cx-del-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          deleteRecord(btn.dataset.id);
          render();
        };
      });

      // 拖拽
      makeDraggable(panel, panel.querySelector('#cx-drag'));
    }

    // 初始渲染
    render();

    // 价格可能异步加载，3秒后自动刷新一次
    setTimeout(render, 3000);
    setTimeout(render, 6000);
  }

  // Toast提示
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'cx-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  // 拖拽功能
  function makeDraggable(panel, handle) {
    if (!handle) return;
    let isDragging = false, startX, startY, origX, origY;
    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panel.style.left = (origX + e.clientX - startX) + 'px';
      panel.style.top = (origY + e.clientY - startY) + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });
  }

  // ==========================================
  //  四、启动
  // ==========================================

  // 等页面基本加载完再插入面板
  if (document.readyState === 'complete') {
    createPanel();
  } else {
    window.addEventListener('load', () => setTimeout(createPanel, 1000));
  }

})();
