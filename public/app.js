async function load(){
  const r = await fetch('/api/scan');
  const d = await r.json();
  document.getElementById('summary').innerHTML = `模式: ${d.mode} | 权益: ${d.equity}U | 今日PnL: ${d.pnlToday} | 连亏: ${d.consecutiveLosses} | KillSwitch: ${d.killSwitch}`;
  const tb = document.querySelector('#tbl tbody'); tb.innerHTML='';
  d.rows.forEach(x=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${x.symbol}</td><td>${x.price}</td><td>${x.minNotional}U</td><td>${x.neededLeverage||'不可开'}</td><td>${x.trend15m}</td><td>${x.structure5m}</td><td>${x.entry1m}</td><td>${x.strategy}</td><td>${x.netExpected}</td><td class='${x.riskLevel}'>${x.riskLevel}</td><td>${x.recommendPool?'YES':'NO'}</td>`;
    tb.appendChild(tr);
  });
  document.getElementById('trades').textContent = d.tradeLogs.map(x=>`${x.ts} ${x.symbol} ${x.side} x${x.leverage} margin:${x.margin} pnl:${x.pnl}`).join('\n') || '暂无';
  document.getElementById('risks').textContent = d.riskLogs.map(x=>`${x.ts} ${x.symbol} ${x.status} net:${x.netExpected}`).join('\n') || '暂无';
}
document.getElementById('kill').onclick = async()=>{ await fetch('/api/kill-switch',{method:'POST'}); await load(); };
load(); setInterval(load,5000);
