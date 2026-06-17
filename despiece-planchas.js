const formatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });

const sheetFields = {
  preset: document.querySelector("#sheet-preset"),
  material: document.querySelector("#sheet-material"),
  length: document.querySelector("#sheet-length"),
  width: document.querySelector("#sheet-width"),
  thickness: document.querySelector("#sheet-thickness"),
  kerf: document.querySelector("#kerf"),
  margin: document.querySelector("#margin"),
  grain: document.querySelector("#grain-mode"),
};

const optimizer = {
  editor: document.querySelector("#parts-editor"),
  addPart: document.querySelector("#add-part"),
  sheets: document.querySelector("#metric-sheets"),
  efficiency: document.querySelector("#metric-efficiency"),
  waste: document.querySelector("#metric-waste"),
  kerf: document.querySelector("#metric-kerf"),
  warning: document.querySelector("#optimizer-warning"),
  output: document.querySelector("#sheet-output"),
  report: document.querySelector("#cut-report"),
};

let partRows = [
  { name: "Lateral izquierdo", length: 720, width: 500, quantity: 2 },
  { name: "Techo / piso", length: 800, width: 500, quantity: 2 },
  { name: "Estante", length: 764, width: 480, quantity: 2 },
  { name: "Puerta", length: 760, width: 396, quantity: 2 },
  { name: "Fondo", length: 780, width: 700, quantity: 1 },
];

function mm(value) {
  return `${formatter.format(Math.max(value, 0))} mm`;
}

function pct(value) {
  return `${formatter.format(Math.max(value, 0))}%`;
}

function number(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function renderPartRows() {
  optimizer.editor.innerHTML = partRows.map((part, index) => `
    <div class="part-row" data-index="${index}">
      <label>
        <span>Pieza</span>
        <input class="part-name" value="${part.name}">
      </label>
      <label>
        <span>Largo</span>
        <input class="part-length" type="number" min="1" step="1" value="${part.length}">
      </label>
      <label>
        <span>Ancho</span>
        <input class="part-width" type="number" min="1" step="1" value="${part.width}">
      </label>
      <label>
        <span>Cant.</span>
        <input class="part-quantity" type="number" min="1" step="1" value="${part.quantity}">
      </label>
      <button class="remove-part" type="button" aria-label="Quitar pieza">Quitar</button>
    </div>
  `).join("");
}

function syncPartsFromDom() {
  partRows = [...optimizer.editor.querySelectorAll(".part-row")].map((row) => ({
    name: row.querySelector(".part-name").value.trim() || "Pieza",
    length: number(row.querySelector(".part-length").value),
    width: number(row.querySelector(".part-width").value),
    quantity: Math.max(1, Math.round(number(row.querySelector(".part-quantity").value))),
  }));
}

function expandParts(parts, allowRotate) {
  return parts.flatMap((part) => {
    return Array.from({ length: part.quantity }, (_, index) => ({
      id: `${part.name}-${index + 1}`,
      name: part.name,
      length: part.length,
      width: part.width,
      area: part.length * part.width,
      canRotate: allowRotate,
    }));
  }).sort((a, b) => b.area - a.area);
}

function createSheet(index, sheetLength, sheetWidth, margin) {
  return {
    index,
    shelves: [],
    placements: [],
    sheetLength,
    sheetWidth,
    cursorY: margin,
  };
}

function tryPlaceInShelf(sheet, piece, settings) {
  const orientations = piece.canRotate
    ? [
      { length: piece.length, width: piece.width, rotated: false },
      { length: piece.width, width: piece.length, rotated: true },
    ]
    : [{ length: piece.length, width: piece.width, rotated: false }];

  for (const shelf of sheet.shelves) {
    for (const orientation of orientations) {
      const neededLength = shelf.x === settings.margin ? orientation.length : orientation.length + settings.kerf;
      if (shelf.x + neededLength <= settings.sheetLength - settings.margin && orientation.width <= shelf.height) {
        const x = shelf.x === settings.margin ? shelf.x : shelf.x + settings.kerf;
        const placement = { ...piece, ...orientation, x, y: shelf.y, sheet: sheet.index };
        shelf.x = x + orientation.length;
        sheet.placements.push(placement);
        return true;
      }
    }
  }

  for (const orientation of orientations) {
    const y = sheet.shelves.length === 0 ? settings.margin : sheet.cursorY + settings.kerf;
    if (
      orientation.length <= settings.sheetLength - settings.margin * 2
      && y + orientation.width <= settings.sheetWidth - settings.margin
    ) {
      const shelf = { x: settings.margin + orientation.length, y, height: orientation.width };
      sheet.shelves.push(shelf);
      sheet.cursorY = y + orientation.width;
      sheet.placements.push({ ...piece, ...orientation, x: settings.margin, y, sheet: sheet.index });
      return true;
    }
  }

  return false;
}

function optimize(parts, settings) {
  const expanded = expandParts(parts, settings.allowRotate);
  const invalid = expanded.filter((piece) => {
    const fitsNormal = piece.length <= settings.sheetLength - settings.margin * 2
      && piece.width <= settings.sheetWidth - settings.margin * 2;
    const fitsRotated = settings.allowRotate
      && piece.width <= settings.sheetLength - settings.margin * 2
      && piece.length <= settings.sheetWidth - settings.margin * 2;
    return !fitsNormal && !fitsRotated;
  });

  const sheets = [createSheet(1, settings.sheetLength, settings.sheetWidth, settings.margin)];

  for (const piece of expanded.filter((item) => !invalid.includes(item))) {
    let placed = sheets.some((sheet) => tryPlaceInShelf(sheet, piece, settings));
    if (!placed) {
      const sheet = createSheet(sheets.length + 1, settings.sheetLength, settings.sheetWidth, settings.margin);
      placed = tryPlaceInShelf(sheet, piece, settings);
      sheets.push(sheet);
    }
  }

  return { sheets, invalid };
}

function renderSheets(plan, settings) {
  optimizer.output.innerHTML = plan.sheets.map((sheet) => {
    const scale = Math.min(1, 680 / settings.sheetLength);
    const width = settings.sheetLength * scale;
    const height = settings.sheetWidth * scale;
    const pieces = sheet.placements.map((piece, index) => {
      const color = piece.rotated ? "#74a892" : "#d6a46d";
      return `
        <g>
          <rect x="${piece.x * scale}" y="${piece.y * scale}" width="${piece.length * scale}" height="${piece.width * scale}" fill="${color}" stroke="#111" stroke-width="1.4" />
          <text x="${(piece.x + 8) * scale}" y="${(piece.y + 18) * scale}" font-size="11" font-weight="800" fill="#111">${sheet.index}.${index + 1}</text>
          <text x="${(piece.x + 8) * scale}" y="${(piece.y + 34) * scale}" font-size="9" fill="#111">${piece.length} x ${piece.width}</text>
        </g>
      `;
    }).join("");

    return `
      <article class="sheet-card">
        <h3>Plancha P${String(sheet.index).padStart(2, "0")}</h3>
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Despiece de plancha ${sheet.index}">
          <rect x="0" y="0" width="${width}" height="${height}" fill="#eef3ed" stroke="#2f3a36" stroke-width="2" />
          <rect x="${settings.margin * scale}" y="${settings.margin * scale}" width="${(settings.sheetLength - settings.margin * 2) * scale}" height="${(settings.sheetWidth - settings.margin * 2) * scale}" fill="none" stroke="#0f7c70" stroke-dasharray="6 5" stroke-width="1.4" />
          ${pieces}
        </svg>
      </article>
    `;
  }).join("");
}

function renderReport(plan) {
  const rows = plan.sheets.flatMap((sheet) => {
    return sheet.placements.map((piece, index) => `
      <tr>
        <td>P${String(sheet.index).padStart(2, "0")}</td>
        <td>A${index + 1}</td>
        <td>${piece.name}</td>
        <td>${mm(piece.length)} x ${mm(piece.width)}</td>
        <td>X ${mm(piece.x)} / Y ${mm(piece.y)}</td>
        <td>${piece.rotated ? "Rotada" : "Normal"}</td>
      </tr>
    `);
  });
  optimizer.report.innerHTML = rows.join("");
}

function calculate() {
  syncPartsFromDom();

  const settings = {
    sheetLength: number(sheetFields.length.value),
    sheetWidth: number(sheetFields.width.value),
    kerf: number(sheetFields.kerf.value),
    margin: number(sheetFields.margin.value),
    allowRotate: sheetFields.grain.value === "free",
  };

  const plan = optimize(partRows, settings);
  const placedArea = plan.sheets.reduce((sum, sheet) => {
    return sum + sheet.placements.reduce((pieceSum, piece) => pieceSum + piece.area, 0);
  }, 0);
  const totalArea = plan.sheets.length * settings.sheetLength * settings.sheetWidth;
  const cuts = plan.sheets.reduce((sum, sheet) => sum + sheet.placements.length * 2, 0);
  const efficiency = totalArea ? (placedArea / totalArea) * 100 : 0;

  optimizer.sheets.textContent = String(plan.sheets.length);
  optimizer.efficiency.textContent = pct(efficiency);
  optimizer.waste.textContent = pct(100 - efficiency);
  optimizer.kerf.textContent = mm(cuts * settings.kerf);

  if (plan.invalid.length > 0) {
    optimizer.warning.hidden = false;
    optimizer.warning.textContent = `${plan.invalid.length} pieza(s) no caben en la plancha con el margen configurado. Revisa dimensiones u orientación de grano.`;
  } else {
    optimizer.warning.hidden = true;
    optimizer.warning.textContent = "";
  }

  renderSheets(plan, settings);
  renderReport(plan);
}

sheetFields.preset.addEventListener("change", () => {
  if (sheetFields.preset.value === "custom") return;
  const [length, width] = sheetFields.preset.value.split("x");
  sheetFields.length.value = length;
  sheetFields.width.value = width;
  calculate();
});

optimizer.addPart.addEventListener("click", () => {
  syncPartsFromDom();
  partRows.push({ name: "Nueva pieza", length: 600, width: 300, quantity: 1 });
  renderPartRows();
  calculate();
});

optimizer.editor.addEventListener("input", calculate);
optimizer.editor.addEventListener("click", (event) => {
  if (!event.target.classList.contains("remove-part")) return;
  syncPartsFromDom();
  const row = event.target.closest(".part-row");
  const index = Number.parseInt(row.dataset.index, 10);
  partRows.splice(index, 1);
  renderPartRows();
  calculate();
});

Object.values(sheetFields).forEach((field) => {
  field.addEventListener("input", calculate);
  field.addEventListener("change", calculate);
});

renderPartRows();
calculate();
