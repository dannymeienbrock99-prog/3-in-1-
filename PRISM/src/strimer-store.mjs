// One queue belongs to the RGB page, rather than to an individual mount of its
// cable panel. Reads after remount wait for every previously queued draft save.
export function createStrimerStore(request){
 let pending=Promise.resolve();
 const enqueue=task=>{const result=pending.catch(()=>{}).then(task);pending=result;return result;};
 return{load:()=>enqueue(()=>request('strimer-preview')),save:draft=>enqueue(()=>request('strimer-preview',{draft}))};
}
