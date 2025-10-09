// api/sipay/return.js
// Sipay 3D dönüşünü yakala → 303 redirect ile teşekkürler sayfasına yönlendir

const querystring = require('querystring');

function readRaw(req){
  return new Promise((resolve,reject)=>{
    let s=''; req.on('data',c=>s+=c);
    req.on('end', ()=> resolve(s||''));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  // Sipay genelde POST ile döner (response_method=POST)
  const raw = await readRaw(req);
  const isJson = (req.headers['content-type']||'').includes('application/json');
  const p = isJson ? ( (()=>{ try{return JSON.parse(raw||'{}');}catch(_){return {};}})() )
                   : querystring.parse(raw);

  // Teşekkürler sayfanız (BURAYI kendi URL’inizle değiştirin)
  const THANKS_URL = process.env.THANKS_URL || 'https://do-lab.co/tesekkur_ederiz';

  // İstediğiniz parametreleri taşıyın
  const params = new URLSearchParams({
    status: (p.payment_status||p.status||'').toString(),
    order_id: (p.order_id||'').toString(),
    invoice_id: (p.invoice_id||'').toString(),
    amount: (p.amount||p.total||'').toString(),
    currency: (p.currency_code||'').toString(),
    code: (p.status_code||'').toString(),
    desc: (p.status_description||p.error||'').toString()
  });

  res.statusCode = 303; // See Other
  res.setHeader('Location', `${THANKS_URL}?${params.toString()}`);
  res.end();
};
