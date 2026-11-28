import { useRef, useState, type PointerEvent } from "react";

type SliderHoverOptions = {
  min: number;
  max: number;
  rtl: boolean;
  onSeek: (value: number) => void;
};

const fallbackThumbSize = 18;
const clickTolerance = 4;

// Maps a pointer position on the rail to a slider value the same way WebKit does:
// the thumb center travels between half a thumb from each end, and the value rounds to a step.
export function sliderValueAt(
  rect: { left: number; width: number },
  clientX: number,
  thumbSize: number,
  { min, max, rtl }: { min: number; max: number; rtl: boolean },
): number {
  const track = rect.width - thumbSize;
  if (track <= 0 || max <= min) {
    return min;
  }
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left - thumbSize / 2) / track));
  return Math.round(min + (rtl ? 1 - ratio : ratio) * (max - min));
}

function isOnMarker(target: EventTarget): boolean {
  return target instanceof Element && target.closest(".reader-slider-bookmark") !== null;
}

function sliderInput(rail: HTMLElement): HTMLInputElement | null {
  return rail.querySelector('input[type="range"]');
}

export function useSliderHover({ min, max, rtl, onSeek }: SliderHoverOptions) {
  const [value, setValue] = useState<number | null>(null);
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  function pointerValue(rail: HTMLElement, clientX: number): number {
    const thumbSize =
      Number(
        getComputedStyle(rail)
          .getPropertyValue("--reader-slider-thumb-size")
          .trim()
          .replace(/px$/, ""),
      ) || fallbackThumbSize;
    return sliderValueAt(rail.getBoundingClientRect(), clientX, thumbSize, { min, max, rtl });
  }

  function update(event: PointerEvent<HTMLElement>) {
    const rail = event.currentTarget;
    const input = sliderInput(rail);
    if (!input || input.disabled || isOnMarker(event.target)) {
      setValue(null);
      return;
    }
    // While dragging, follow the thumb itself, which may be grabbed off-center.
    setValue(
      pressRef.current && event.buttons !== 0
        ? input.valueAsNumber
        : pointerValue(rail, event.clientX),
    );
  }

  return {
    value,
    handlers: {
      onPointerMove: update,
      onPointerEnter: update,
      onPointerLeave: () => {
        if (!pressRef.current) {
          setValue(null);
        }
      },
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (isOnMarker(event.target)) {
          pressRef.current = null;
          return;
        }
        pressRef.current = { x: event.clientX, y: event.clientY };
        // A drag can end outside the rail, where the rail never sees the pointerup.
        window.addEventListener(
          "pointerup",
          () => {
            if (pressRef.current) {
              pressRef.current = null;
              setValue(null);
            }
          },
          { once: true },
        );
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        const press = pressRef.current;
        pressRef.current = null;
        const input = sliderInput(event.currentTarget);
        if (!press || !input || input.disabled || isOnMarker(event.target)) {
          return;
        }
        const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
        if (moved <= clickTolerance) {
          // A click lands on exactly the page shown in the hover label.
          onSeek(pointerValue(event.currentTarget, event.clientX));
        }
        update(event);
      },
    },
  };
}
