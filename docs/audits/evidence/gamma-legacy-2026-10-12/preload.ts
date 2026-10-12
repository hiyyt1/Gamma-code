setTimeout(async()=>{await Bun.write('/tmp/gamma-legacy-audit/loaded-modules.json',JSON.stringify(Object.keys(require.cache).sort(),null,2))},5000).unref()
