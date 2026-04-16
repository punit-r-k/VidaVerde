let activeLocks = 0;
let lockedScrollY = 0;
let previousHtmlOverflow = "";
let previousBodyStyles = null;

export function lockPageScroll() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  activeLocks += 1;
  if (activeLocks > 1) {
    return;
  }

  const { body, documentElement } = document;
  lockedScrollY = window.scrollY || window.pageYOffset || 0;
  previousHtmlOverflow = documentElement.style.overflow;
  previousBodyStyles = {
    overflow: body.style.overflow,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width
  };

  documentElement.style.overflow = "hidden";
  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${lockedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
}

export function unlockPageScroll() {
  if (typeof window === "undefined" || typeof document === "undefined" || activeLocks === 0) {
    return;
  }

  activeLocks -= 1;
  if (activeLocks > 0) {
    return;
  }

  const { body, documentElement } = document;

  documentElement.style.overflow = previousHtmlOverflow;
  body.style.overflow = previousBodyStyles?.overflow || "";
  body.style.position = previousBodyStyles?.position || "";
  body.style.top = previousBodyStyles?.top || "";
  body.style.left = previousBodyStyles?.left || "";
  body.style.right = previousBodyStyles?.right || "";
  body.style.width = previousBodyStyles?.width || "";

  window.scrollTo(0, lockedScrollY);

  previousHtmlOverflow = "";
  previousBodyStyles = null;
}
