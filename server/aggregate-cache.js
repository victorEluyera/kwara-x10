export function aggregateCache({ttl=300000,now=Date.now}={}) {
  let cached=null,pending=null,generation=0;
  return {
    clear(){cached=null;pending=null;generation++;},
    get(load){
      if(cached&&now()-cached.at<ttl)return Promise.resolve(cached.value);
      if(pending)return pending;
      const version=generation;
      const request=Promise.resolve().then(load).then(value=>{
        if(version===generation)cached={at:now(),value};
        return value;
      }).finally(()=>{if(pending===request)pending=null;});
      pending=request;return request;
    },
  };
}
