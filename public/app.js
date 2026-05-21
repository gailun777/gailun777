async function load(){
  const r = await fetch('/api/scan');
  const d = await r.json();
  if (d.error) {
    document.getElementById('summary').innerHTML = `扫描失败: ${d.detail}`;
    return;
  }
  document.getElementById('summary').innerHTML = `模式: ${d.mode} | 数据源: ${d.source} | 合约数: ${d.rows.length} | KillSwitch: ${d.killSwitch} | 实盘: 禁用`;
  const tb = document.querySelector('#tbl tbody'); tb.innerHTML='';
  d.rows.forEach(x=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${x.symbol}</td><td>${x.price}</td><td>${Math.round(x.volume24hQuote).toLocaleString()}</td><td>${x.fundingRate}</td><td>${x.orderSizeMin}</td><td>${x.contractMultiplier}</td><td>${x.maxLeverage}</td><td>${x.bestBid}</td><td>${x.bestAsk}</td><td>${x.spreadBps}</td><td>${Math.round(x.depthNotionalUSDT).toLocaleString()}</td><td>${x.openWith1U20x?'YES':'NO'}</td><td>${x.minNotional}</td><td class='${x.riskLevel}'>${x.riskLevel}</td><td>${x.recommendPool?'YES':'NO'}</td>`;
    tb.appendChild(tr);
  });
  document.getElementById('risks').textContent = d.riskLogs?.map(x=>`${x.ts} ${x.symbol} ${x.status}`).join('\n') || '暂无';
}
document.getElementById('kill').onclick = async()=>{ await fetch('/api/kill-switch',{method:'POST'}); await load(); };
load(); setInterval(load,10000);
