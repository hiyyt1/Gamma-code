# outline.json
Creative HTML route: {"title":"...","audience":"...","objective":"...","direction":"Editorial Minimal","font":"Liberation Sans"}. Pass ordered HTML paths to build.
Structured route adds width:13.333333, height:7.5 and slides (1–40). Each slide: {title,takeaway,notes,sources:[],background:"FFFFFF",elements:[]}. One clear claim per slide.
Elements use inches x,y,w,h and type:
- text: text, size (points, default24), color (six hex digits), bold, align:left|center|right.
- shape: shape:rect|ellipse|line|chevron|roundRect|rightArrow, color, optional line color.
- image: path (workspace-relative PNG/JPEG), alt. Preserve aspect ratio.
- chart: dataset (ID from aggregate), kind:bar|line|pie|doughnut|area, title.
- table: rows (arrays of strings), size (points).
Native geometry is arbitrary within the canvas, not six templates. No overflowing elements; 80 objects maximum per slide. Data chart arrays cannot be supplied directly. Keep assumptions and evidence in sources/brief.json and notes.
