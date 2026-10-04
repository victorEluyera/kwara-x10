/** Bound a read request so the page can offer retry when it stalls. */
export async function loadWithTimeout(load,milliseconds=30000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(load),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Loading took too long. Please retry.')),milliseconds);}),
    ]);
  } finally {clearTimeout(timer);}
}
