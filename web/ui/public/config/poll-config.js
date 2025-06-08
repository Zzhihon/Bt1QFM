(function(){
  let currentText = '';
  async function check(){
    try {
      const res = await fetch('/1qfm/config/env-config.js');
      const text = await res.text();
      if(!currentText){
        currentText = text;
      } else if(text !== currentText){
        location.reload();
      }
    } catch(e){
      console.error('Failed to fetch env config', e);
    }
  }
  check();
  setInterval(check, 30000);
})();
