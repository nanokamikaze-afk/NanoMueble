const numberFormat = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 1,
});

const fields = {
  cabinetWidth: document.querySelector("#cabinet-width"),
  cabinetHeight: document.querySelector("#cabinet-height"),
  cabinetDepth: document.querySelector("#cabinet-depth"),
  drawerCount: document.querySelector("#drawer-count"),
  slideThickness: document.querySelector("#slide-thickness"),
  slideLength: document.querySelector("#slide-length"),
  depthDiscount: document.querySelector("#depth-discount"),
  verticalGap: document.querySelector("#vertical-gap"),
  materialThickness: document.querySelector("#material-thickness"),
  bottomThickness: document.querySelector("#bottom-thickness"),
  bottomMode: document.querySelector("#bottom-mode"),
  grooveDepth: document.querySelector("#groove-depth"),
  showStructure: document.querySelector("#show-structure"),
};

const results = {
  width: document.querySelector("#result-width"),
  height: document.querySelector("#result-height"),
  depth: document.querySelector("#result-depth"),
  gap: document.querySelector("#result-gap"),
  doorWidth: document.querySelector("#result-door-width"),
  doorHeight: document.querySelector("#result-door-height"),
  warning: document.querySelector("#depth-warning"),
  cutList: document.querySelector("#cut-list"),
  preview: document.querySelector("#preview-cabinet"),
  hero: document.querySelector("#hero-model"),
};

const modelViews = {
  hero: { yaw: 160, pitch: 12 },
  preview: { yaw: 180, pitch: 12 },
};

let latestModelOptions = null;
let selectedDrawerIndex = null;
let drawerOpenProgress = 0;
let drawerAnimationFrame = null;

function toNumber(field) {
  const value = Number.parseFloat(field.value);
  return Number.isFinite(value) ? value : 0;
}

function mm(value) {
  return `${numberFormat.format(Math.max(value, 0))} mm`;
}

function measure(value) {
  return typeof value === "number" ? mm(value) : value;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function makeProjector(view) {
  const yawRadians = (view.yaw * Math.PI) / 180;
  const pitchRadians = (view.pitch * Math.PI) / 180;
  const cosYaw = Math.cos(yawRadians);
  const sinYaw = Math.sin(yawRadians);
  const cosPitch = Math.cos(pitchRadians);
  const sinPitch = Math.sin(pitchRadians);
  const scale = 0.92;
  const originX = 382;
  const originY = 258;

  return (point) => {
    const yawX = point.x * cosYaw - point.z * sinYaw;
    const yawZ = point.x * sinYaw + point.z * cosYaw;
    const pitchY = point.y * cosPitch - yawZ * sinPitch;
    const pitchZ = point.y * sinPitch + yawZ * cosPitch;

    return {
      x: originX + yawX * scale,
      y: originY + pitchY * scale,
      depth: pitchZ,
    };
  };
}

function face(points, className, project, extra = "") {
  const projected = points.map(project);
  const coords = projected.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const depth = projected.reduce((sum, point) => sum + point.depth, 0) / projected.length;
  return { depth, markup: `<polygon class="${className.trim()}" points="${coords}" ${extra} />` };
}

function line3d(a, b, className, project) {
  const pa = project(a);
  const pb = project(b);
  const depth = (pa.depth + pb.depth) / 2;
  return {
    depth,
    markup: `<line class="${className}" x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}" />`,
  };
}

function label3d(text, point, className, project, rotation = 0) {
  const projected = project(point);
  return {
    depth: projected.depth + 500,
    markup: `<text class="${className}" x="${projected.x.toFixed(1)}" y="${projected.y.toFixed(1)}" transform="rotate(${rotation} ${projected.x.toFixed(1)} ${projected.y.toFixed(1)})">${esc(text)}</text>`,
  };
}

function cuboid(x, y, z, width, height, depth, className, project, hiddenFaces = [], extra = "") {
  const x2 = x + width;
  const y2 = y + height;
  const z2 = z + depth;
  const p = {
    ftl: { x, y, z },
    ftr: { x: x2, y, z },
    fbr: { x: x2, y: y2, z },
    fbl: { x, y: y2, z },
    btl: { x, y, z: z2 },
    btr: { x: x2, y, z: z2 },
    bbr: { x: x2, y: y2, z: z2 },
    bbl: { x, y: y2, z: z2 },
  };

  const faces = {
    back: [p.btr, p.btl, p.bbl, p.bbr],
    left: [p.btl, p.ftl, p.fbl, p.bbl],
    right: [p.ftr, p.btr, p.bbr, p.fbr],
    bottom: [p.fbl, p.fbr, p.bbr, p.bbl],
    top: [p.btl, p.btr, p.ftr, p.ftl],
    front: [p.ftl, p.ftr, p.fbr, p.fbl],
  };

  return Object.entries(faces)
    .filter(([name]) => !hiddenFaces.includes(name))
    .map(([name, points]) => {
      const suffixBase = className.trim().split(/\s+/).at(-1);
      return face(points, `${className} ${suffixBase}-${name}`, project, extra);
    });
}

function drawerTray(x, y, z, width, height, depth, project, extra = "") {
  const wall = 10;
  const frontDepth = 12;
  const backDepth = 10;
  const bottomHeight = 9;
  const innerX = x + wall;
  const innerY = y + wall;
  const innerZ = z + frontDepth;
  const innerWidth = width - wall * 2;
  const innerHeight = height - wall - bottomHeight;
  const innerDepth = depth - frontDepth - backDepth;

  return [
    ...cuboid(x, y, z, width, height, frontDepth, "drawer drawer-active drawer-front-panel", project, [], extra),
    ...cuboid(x, y + wall, z + frontDepth, wall, innerHeight, innerDepth, "drawer-shell drawer-left-wall", project, [], extra),
    ...cuboid(x + width - wall, y + wall, z + frontDepth, wall, innerHeight, innerDepth, "drawer-shell drawer-right-wall", project, [], extra),
    ...cuboid(innerX, y + height - bottomHeight, z + frontDepth, innerWidth, bottomHeight, innerDepth, "drawer-shell drawer-bottom-board", project, [], extra),
    ...cuboid(innerX, y + wall, z + depth - backDepth, innerWidth, innerHeight, backDepth, "drawer-shell drawer-back-wall", project, [], extra),
    face(
      [
        { x: innerX, y: innerY, z: innerZ },
        { x: innerX + innerWidth, y: innerY, z: innerZ },
        { x: innerX + innerWidth, y: innerY + innerHeight, z: innerZ + innerDepth },
        { x: innerX, y: innerY + innerHeight, z: innerZ + innerDepth },
      ],
      "drawer-interior",
      project,
      extra,
    ),
  ];
}

function renderCabinet(svg, options, view = modelViews.preview) {
  if (!svg) return;

  const project = makeProjector(view);
  const drawerCount = Math.max(options.drawerCount, 1);
  const showStructure = options.showStructure;
  const activeDrawerIndex = options.selectedDrawerIndex ?? selectedDrawerIndex;
  const openProgress = options.drawerOpenProgress ?? drawerOpenProgress;
  const width = 330;
  const height = 340;
  const depth = 245;
  const board = 24;
  const drawerGap = 16;
  const innerHeight = height - board * 2;
  const drawerHeight = Math.max((innerHeight - drawerGap * (drawerCount - 1)) / drawerCount, 36);
  const innerWidth = width - board * 2;
  const drawerDepth = depth - board * 1.7;
  const x0 = -width / 2;
  const y0 = -height / 2;
  const z0 = -depth / 2;
  const pieces = [];

  pieces.push(...cuboid(x0, y0, z0, board, height, depth, "wood left-panel", project));
  pieces.push(...cuboid(x0 + width - board, y0, z0, board, height, depth, "wood right-panel", project));
  pieces.push(...cuboid(x0, y0, z0, width, board, depth, "wood top-panel", project));
  pieces.push(...cuboid(x0, y0 + height - board, z0, width, board, depth, "wood bottom-panel", project));
  pieces.push(...cuboid(x0, y0, z0 + depth - board, width, height, board, "wood back-panel", project));

  if (showStructure) {
    for (let index = 1; index < drawerCount; index += 1) {
      const shelfY = y0 + board + index * drawerHeight + (index - 0.5) * drawerGap - board / 2;
      pieces.push(...cuboid(x0 + board, shelfY, z0, innerWidth, 12, depth - board, "wood shelf", project));
    }
  }

  for (let index = 0; index < drawerCount; index += 1) {
    const isActive = activeDrawerIndex === index;
    const drawerY = y0 + board + index * (drawerHeight + drawerGap);
    const openOffset = isActive ? -118 * openProgress : 4;
    const openDrop = isActive ? 14 * openProgress : 0;
    const drawerClass = isActive ? "drawer drawer-active" : "drawer drawer-wood";
    const drawerX = x0 + board + 8;
    const activeDrawerY = drawerY + openDrop;
    const drawerZ = z0 + openOffset;
    const drawerWidth = innerWidth - 16;

    if (isActive) {
      pieces.push(...drawerTray(drawerX, activeDrawerY, drawerZ, drawerWidth, drawerHeight, drawerDepth, project, `data-drawer-index="${index}"`));
    } else {
      pieces.push(
        ...cuboid(
          drawerX,
          activeDrawerY,
          drawerZ,
          drawerWidth,
          drawerHeight,
          showStructure ? drawerDepth : 18,
          `${drawerClass} drawer-box`,
          project,
          showStructure ? [] : ["back", "left", "right", "top", "bottom"],
          `data-drawer-index="${index}"`,
        ),
      );
    }

    const hitArea = face(
      [
        { x: drawerX, y: activeDrawerY, z: drawerZ - 1 },
        { x: drawerX + drawerWidth, y: activeDrawerY, z: drawerZ - 1 },
        { x: drawerX + drawerWidth, y: activeDrawerY + drawerHeight, z: drawerZ - 1 },
        { x: drawerX, y: activeDrawerY + drawerHeight, z: drawerZ - 1 },
      ],
      "drawer-hit-area",
      project,
      `data-drawer-index="${index}"`,
    );
    hitArea.depth = 10000 + index;
    pieces.push(hitArea);

    if (showStructure) {
      pieces.push(
        ...cuboid(
          x0 + board + 24,
          activeDrawerY + 14,
          z0 + openOffset - 2,
          innerWidth - 48,
          Math.max(drawerHeight - 28, 12),
          4,
          isActive ? "inset inset-active" : "inset",
          project,
          ["back", "left", "right", "top", "bottom"],
          `data-drawer-index="${index}"`,
        ),
      );
    }
  }

  const heightLineX = x0 - 46;
  const heightLineZ = z0 - 12;
  const depthLineY = y0 + height + 36;
  pieces.push(line3d({ x: heightLineX, y: y0, z: heightLineZ }, { x: heightLineX, y: y0 + height, z: heightLineZ }, "model-dim", project));
  pieces.push(line3d({ x: x0 + width + 22, y: depthLineY, z: z0 }, { x: x0 + width + 22, y: depthLineY, z: z0 + depth }, "model-dim", project));
  pieces.push(line3d({ x: x0, y: depthLineY + 24, z: z0 }, { x: x0 + width, y: depthLineY + 24, z: z0 }, "model-dim", project));
  pieces.push(label3d(mm(options.cabinetHeight), { x: heightLineX - 10, y: 0, z: heightLineZ }, "model-label", project, -90));
  pieces.push(label3d(mm(options.cabinetDepth), { x: x0 + width + 38, y: depthLineY, z: z0 + depth / 2 }, "model-label", project, -42));
  pieces.push(label3d(mm(options.cabinetWidth), { x: 0, y: depthLineY + 38, z: z0 }, "model-label", project, 0));

  const structureClass = showStructure ? "" : " model-hidden-structure";
  const markup = pieces.sort((a, b) => a.depth - b.depth).map((piece) => piece.markup).join("");

  svg.innerHTML = `
    <style>
      .cabinet-model .wood { fill: #9f7650; stroke: #111; stroke-width: 1.9; stroke-linejoin: round; }
      .cabinet-model .top-panel-top,
      .cabinet-model .shelf-top,
      .cabinet-model .drawer-top { fill: #ba8a5e; }
      .cabinet-model .right-panel-right,
      .cabinet-model .left-panel-left,
      .cabinet-model .drawer-right,
      .cabinet-model .drawer-left { fill: #805b3d; }
      .cabinet-model .back-panel-front { fill: #b58a60; }
      .cabinet-model .drawer-wood { fill: #a17951; stroke: #111; stroke-width: 1.9; stroke-linejoin: round; }
      .cabinet-model .drawer-active { fill: #27ad9e; stroke: #111; stroke-width: 2.2; stroke-linejoin: round; }
      .cabinet-model .drawer-front-panel-left,
      .cabinet-model .drawer-front-panel-right { fill: #1f887f; }
      .cabinet-model .drawer-front-panel-top { fill: #35c0b0; }
      .cabinet-model .drawer-shell { fill: #b08458; stroke: #111; stroke-width: 1.65; stroke-linejoin: round; }
      .cabinet-model .drawer-left-wall-right,
      .cabinet-model .drawer-right-wall-left,
      .cabinet-model .drawer-back-wall-front { fill: #8c6543; }
      .cabinet-model .drawer-bottom-board-top,
      .cabinet-model .drawer-interior { fill: #c39968; stroke: #111; stroke-width: 1.25; stroke-linejoin: round; }
      .cabinet-model .inset { fill: rgba(97, 65, 41, 0.28); stroke: #111; stroke-width: 1.2; }
      .cabinet-model .inset-active { fill: rgba(255, 255, 255, 0.14); }
      .cabinet-model .drawer-hit-area { fill: rgba(0, 0, 0, 0.001); stroke: transparent; cursor: pointer; pointer-events: all; }
      .cabinet-model .model-dim { stroke: #111; stroke-width: 1.6; }
      .cabinet-model .model-label { fill: #111; font: 800 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; paint-order: stroke; stroke: #dfe6ee; stroke-width: 4; }
      .cabinet-model .model-shadow { fill: rgba(32, 35, 34, 0.13); }
      .model-hidden-structure .shelf,
      .model-hidden-structure .inset,
      .model-hidden-structure .drawer-box-back,
      .model-hidden-structure .drawer-box-left,
      .model-hidden-structure .drawer-box-right,
      .model-hidden-structure .drawer-box-top,
      .model-hidden-structure .drawer-box-bottom { display: none; }
    </style>
    <g class="${structureClass}">
      <ellipse class="model-shadow" cx="390" cy="447" rx="250" ry="45" />
      ${markup}
    </g>
  `;
}

function animateDrawer(targetProgress, onComplete) {
  if (drawerAnimationFrame) {
    cancelAnimationFrame(drawerAnimationFrame);
  }

  const startProgress = drawerOpenProgress;
  const startTime = performance.now();
  const duration = targetProgress > startProgress ? 520 : 360;

  function step(now) {
    const t = clamp((now - startTime) / duration, 0, 1);
    const eased = targetProgress > startProgress
      ? 1 + 0.08 * Math.sin(Math.PI * t) - Math.pow(1 - t, 3)
      : 1 - Math.pow(1 - t, 3);
    drawerOpenProgress = startProgress + (targetProgress - startProgress) * eased;
    renderModels();

    if (t < 1) {
      drawerAnimationFrame = requestAnimationFrame(step);
    } else {
      drawerOpenProgress = targetProgress;
      drawerAnimationFrame = null;
      if (onComplete) onComplete();
      renderModels();
    }
  }

  drawerAnimationFrame = requestAnimationFrame(step);
}

function renderModels() {
  if (!latestModelOptions) return;
  renderCabinet(results.preview, latestModelOptions, modelViews.preview);
  renderCabinet(
    results.hero,
    { ...latestModelOptions, drawerCount: Math.max(latestModelOptions.drawerCount, 3), showStructure: true, selectedDrawerIndex: null, drawerOpenProgress: 0 },
    modelViews.hero,
  );
}

function calculate() {
  const cabinetWidth = toNumber(fields.cabinetWidth);
  const cabinetHeight = toNumber(fields.cabinetHeight);
  const cabinetDepth = toNumber(fields.cabinetDepth);
  const drawerCount = Number.parseInt(fields.drawerCount.value, 10);
  const slideThickness = toNumber(fields.slideThickness);
  const slideLength = toNumber(fields.slideLength);
  const depthDiscount = toNumber(fields.depthDiscount);
  const verticalGap = toNumber(fields.verticalGap);
  const materialThickness = toNumber(fields.materialThickness);
  const bottomThickness = toNumber(fields.bottomThickness);
  const isGrooved = fields.bottomMode.value === "grooved";
  const grooveDepth = isGrooved ? toNumber(fields.grooveDepth) : 0;
  const showStructure = fields.showStructure ? fields.showStructure.checked : true;
  const doorGap = 2;
  const slideFits = cabinetDepth >= slideLength;

  const drawerWidth = cabinetWidth - slideThickness * 2;
  const totalGap = verticalGap * drawerCount;
  const drawerHeight = (cabinetHeight - totalGap) / drawerCount;
  const drawerDepth = slideFits ? slideLength - depthDiscount : 0;
  const frontBackLength = drawerWidth - materialThickness * 2;
  const bottomWidth = isGrooved ? drawerWidth - materialThickness * 2 + grooveDepth * 2 : drawerWidth;
  const bottomDepth = isGrooved ? drawerDepth - materialThickness * 2 + grooveDepth * 2 : drawerDepth;
  const doorWidth = cabinetWidth - doorGap * 2;
  const doorHeight = (cabinetHeight - doorGap * (drawerCount + 1)) / drawerCount;

  results.width.textContent = mm(drawerWidth);
  results.height.textContent = mm(drawerHeight);
  results.depth.textContent = slideFits ? mm(drawerDepth) : "No compatible";
  results.gap.textContent = mm(totalGap);
  results.doorWidth.textContent = mm(doorWidth);
  results.doorHeight.textContent = mm(doorHeight);

  if (slideFits) {
    results.warning.hidden = true;
    results.warning.textContent = "";
  } else {
    results.warning.hidden = false;
    results.warning.textContent = `El fondo disponible (${mm(cabinetDepth)}) no puede ser menor que el largo de la corredera (${mm(slideLength)}). Usa una corredera mas corta o aumenta el fondo del mueble.`;
  }

  const pieces = [
    ["Lateral izquierdo", drawerCount, drawerHeight, slideFits ? drawerDepth : "No compatible", `${mm(materialThickness)} tablero`],
    ["Lateral derecho", drawerCount, drawerHeight, slideFits ? drawerDepth : "No compatible", `${mm(materialThickness)} tablero`],
    ["Frente interior", drawerCount, drawerHeight, frontBackLength, `${mm(materialThickness)} tablero`],
    ["Trasera", drawerCount, drawerHeight, frontBackLength, `${mm(materialThickness)} tablero`],
    ["Fondo", drawerCount, bottomWidth, slideFits ? bottomDepth : "No compatible", `${mm(bottomThickness)} fondo`],
    ["Puerta / frente visible", drawerCount, doorHeight, doorWidth, "frente con 2 mm de luz"],
  ];

  results.cutList.innerHTML = pieces
    .map(
      ([name, quantity, width, length, material]) => `
        <tr>
          <td>${name}</td>
          <td>${quantity}</td>
          <td>${measure(width)}</td>
          <td>${measure(length)}</td>
          <td>${material}</td>
        </tr>
      `,
    )
    .join("");

  latestModelOptions = { cabinetWidth, cabinetHeight, cabinetDepth, drawerCount, showStructure };
  if (selectedDrawerIndex !== null && selectedDrawerIndex >= drawerCount) {
    selectedDrawerIndex = null;
  }
  renderModels();
}

Object.values(fields).forEach((field) => {
  field.addEventListener("input", calculate);
  field.addEventListener("change", calculate);
});

calculate();

function bindModelDrag(svg, view) {
  if (!svg) return;

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let totalMovement = 0;
  let ignoreNextClick = false;
  let drawerGestureIndex = null;

  function findDrawerTarget(event) {
    let target = event.target.closest("[data-drawer-index]");
    if (!target) {
      target = [...svg.querySelectorAll(".drawer-hit-area")].find((area) => {
        const rect = area.getBoundingClientRect();
        return event.clientX >= rect.left
          && event.clientX <= rect.right
          && event.clientY >= rect.top
          && event.clientY <= rect.bottom;
      });
    }
    return target && svg.contains(target) ? target : null;
  }

  function toggleDrawer(drawerIndex) {
    if (selectedDrawerIndex === drawerIndex) {
      animateDrawer(0, () => {
        selectedDrawerIndex = null;
      });
    } else {
      selectedDrawerIndex = drawerIndex;
      drawerOpenProgress = 0;
      animateDrawer(1);
    }
  }

  svg.addEventListener("pointerdown", (event) => {
    isDragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    totalMovement = 0;
    const drawerTarget = findDrawerTarget(event);
    drawerGestureIndex = drawerTarget ? Number.parseInt(drawerTarget.dataset.drawerIndex, 10) : null;
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("is-dragging");
  });

  svg.addEventListener("pointermove", (event) => {
    if (!isDragging) return;
    const deltaX = event.clientX - lastX;
    const deltaY = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    totalMovement += Math.abs(deltaX) + Math.abs(deltaY);
    if (drawerGestureIndex !== null) return;
    view.yaw -= deltaX * 0.45;
    view.pitch = ((view.pitch - deltaY * 0.35 + 180) % 360) - 180;
    renderModels();
  });

  const stopDragging = (event) => {
    if (drawerGestureIndex !== null && totalMovement > 8) {
      toggleDrawer(drawerGestureIndex);
      ignoreNextClick = true;
      window.setTimeout(() => {
        ignoreNextClick = false;
      }, 0);
    }
    if (totalMovement > 8) {
      ignoreNextClick = true;
      window.setTimeout(() => {
        ignoreNextClick = false;
      }, 0);
    }
    isDragging = false;
    svg.classList.remove("is-dragging");
    if (event.pointerId !== undefined && svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
    drawerGestureIndex = null;
  };

  svg.addEventListener("pointerup", stopDragging);
  svg.addEventListener("pointercancel", stopDragging);
  svg.addEventListener("pointerleave", stopDragging);

  svg.addEventListener("click", (event) => {
    if (ignoreNextClick) return;
    const target = findDrawerTarget(event);
    if (!target || !svg.contains(target)) {
      animateDrawer(0, () => {
        selectedDrawerIndex = null;
      });
      return;
    }

    const drawerIndex = Number.parseInt(target.dataset.drawerIndex, 10);
    toggleDrawer(drawerIndex);
  });
}

bindModelDrag(results.preview, modelViews.preview);
