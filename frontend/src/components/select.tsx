"use client";

import {
  CaretUpDownIcon,
  CheckIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Children,
  forwardRef,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

export type DropdownOption = {
  value: string;
  label: string;
  detail?: string;
  group?: string;
  disabled?: boolean;
};

/** Long lists get a search field; short ones do not need the extra chrome. */
const SEARCH_THRESHOLD = 8;
const PANEL_MAX_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;

function textOf(node: ReactNode): string {
  let text = "";
  Children.forEach(node, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      text += child;
    } else if (isValidElement<{ children?: ReactNode }>(child)) {
      text += textOf(child.props.children);
    }
  });
  return text;
}

/** Reads the `<option>` and `<optgroup>` children a native select would get. */
export function optionsFromChildren(
  children: ReactNode,
  group?: string,
): DropdownOption[] {
  const options: DropdownOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<Record<string, unknown>>;
    const props = element.props;
    if (element.type === Fragment) {
      options.push(
        ...optionsFromChildren(props.children as ReactNode, group),
      );
    } else if (element.type === "optgroup") {
      options.push(
        ...optionsFromChildren(
          props.children as ReactNode,
          props.label as string,
        ),
      );
    } else if (element.type === "option") {
      const label =
        (props.label as string | undefined) ??
        textOf(props.children as ReactNode);
      options.push({
        value: String(props.value ?? label),
        label,
        detail: props["data-detail"] as string | undefined,
        group,
        disabled: Boolean(props.disabled),
      });
    }
  });
  return options;
}

function useDropdown({
  options,
  selected,
  closeOnPick,
  onPick,
  onClosed,
}: {
  options: DropdownOption[];
  selected: string[];
  closeOnPick: boolean;
  onPick: (value: string) => void;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchable = options.length >= SEARCH_THRESHOLD;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      [option.label, option.detail, option.group].some((text) =>
        text?.toLowerCase().includes(needle),
      ),
    );
  }, [options, query]);

  function openList() {
    const selectedIndex = options.findIndex((option) =>
      selected.includes(option.value),
    );
    setQuery("");
    setActiveIndex(
      selectedIndex >= 0
        ? selectedIndex
        : options.findIndex((option) => !option.disabled),
    );
    setEverOpened(true);
    setOpen(true);
  }

  const close = useCallback(
    (returnFocus = true) => {
      setOpen(false);
      if (returnFocus) onClosed();
    },
    [onClosed],
  );

  function move(step: number) {
    if (!visible.length) return;
    let next = activeIndex;
    for (let tries = 0; tries < visible.length; tries += 1) {
      next = (next + step + visible.length) % visible.length;
      if (!visible[next]?.disabled) break;
    }
    setActiveIndex(next);
  }

  function pick(option: DropdownOption | undefined) {
    if (!option || option.disabled) return;
    onPick(option.value);
    if (closeOnPick) close();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    const consumed = () => {
      event.preventDefault();
      event.stopPropagation();
      // A surrounding modal listens on the document for Escape.
      event.nativeEvent.stopPropagation();
    };
    switch (event.key) {
      case "ArrowDown":
        consumed();
        move(1);
        break;
      case "ArrowUp":
        consumed();
        move(-1);
        break;
      case "Home":
        consumed();
        setActiveIndex(visible.findIndex((option) => !option.disabled));
        break;
      case "End":
        consumed();
        setActiveIndex(
          visible.findLastIndex((option) => !option.disabled),
        );
        break;
      case "Enter":
        consumed();
        pick(visible[activeIndex]);
        break;
      case " ":
        if (searchable) break;
        consumed();
        pick(visible[activeIndex]);
        break;
      case "Escape":
        consumed();
        close();
        break;
      case "Tab":
        consumed();
        close();
        break;
      default:
        if (!searchable && event.key.length === 1) {
          const letter = event.key.toLowerCase();
          const start = activeIndex + 1;
          const rotated = [
            ...visible.slice(start),
            ...visible.slice(0, start),
          ];
          const match = rotated.find(
            (option) =>
              !option.disabled && option.label.toLowerCase().startsWith(letter),
          );
          if (match) {
            consumed();
            setActiveIndex(visible.indexOf(match));
          }
        }
    }
  }

  return {
    open,
    everOpened,
    query,
    searchable,
    visible,
    activeIndex,
    setActiveIndex,
    setQuery(next: string) {
      setQuery(next);
      setActiveIndex(0);
    },
    openList,
    close,
    pick,
    handleKeyDown,
  };
}

function DropdownPanel({
  anchorRef,
  listId,
  label,
  multiple,
  selected,
  dropdown,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  listId: string;
  label?: string;
  multiple: boolean;
  selected: string[];
  dropdown: ReturnType<typeof useDropdown>;
}) {
  const { close, open, searchable, visible, activeIndex, setActiveIndex } =
    dropdown;
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [placement, setPlacement] = useState({
    top: 0,
    left: 0,
    minWidth: 0,
    maxHeight: PANEL_MAX_HEIGHT,
    above: false,
  });
  const [highlight, setHighlight] = useState({ top: 0, height: 0 });

  const place = useCallback(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const below = window.innerHeight - anchor.bottom - VIEWPORT_MARGIN;
    const aboveSpace = anchor.top - VIEWPORT_MARGIN;
    const above = below < 180 && aboveSpace > below;
    const maxHeight = Math.min(PANEL_MAX_HEIGHT, above ? aboveSpace : below) - 6;
    const width = panelRef.current?.offsetWidth ?? anchor.width;
    const height = panelRef.current?.offsetHeight ?? 0;
    setPlacement({
      top: above ? anchor.top - 6 - Math.min(height, maxHeight) : anchor.bottom + 6,
      left: Math.max(
        VIEWPORT_MARGIN,
        Math.min(anchor.left, window.innerWidth - width - VIEWPORT_MARGIN),
      ),
      minWidth: anchor.width,
      maxHeight,
      above,
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, visible.length]);

  useEffect(() => {
    if (!open) return;
    function onScroll(event: Event) {
      if (!panelRef.current?.contains(event.target as Node)) place();
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !panelRef.current?.contains(target) &&
        !anchorRef.current?.contains(target)
      ) {
        close(false);
      }
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [anchorRef, close, open, place]);

  // One highlight glides between rows rather than each row fading on its own.
  useLayoutEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    if (!row) {
      setHighlight({ top: 0, height: 0 });
      return;
    }
    setHighlight({ top: row.offsetTop, height: row.offsetHeight });
    row.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open, visible]);

  const groupCount = new Set(visible.map((option) => option.group)).size;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={panelRef}
          className="dropdown-panel"
          style={{
            top: placement.top,
            left: placement.left,
            minWidth: placement.minWidth,
            transformOrigin: placement.above ? "50% 100%" : "50% 0",
          }}
          initial={
            reduceMotion
              ? false
              : { opacity: 0, y: placement.above ? 3 : -3, scale: 0.985 }
          }
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={
            reduceMotion
              ? { opacity: 0, transition: { duration: 0 } }
              : { opacity: 0, scale: 0.99, transition: { duration: 0.09 } }
          }
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
        >
          {searchable ? (
            <label className="dropdown-search">
              <MagnifyingGlassIcon size={13} aria-hidden="true" />
              <input
                autoFocus
                type="text"
                aria-label="Search options"
                aria-controls={listId}
                aria-activedescendant={
                  activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
                }
                placeholder="Search"
                value={dropdown.query}
                onChange={(event) => dropdown.setQuery(event.target.value)}
                onKeyDown={dropdown.handleKeyDown}
              />
            </label>
          ) : null}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            aria-multiselectable={multiple || undefined}
            className="dropdown-list"
            style={{ maxHeight: placement.maxHeight - (searchable ? 36 : 0) }}
          >
            <span
              className="dropdown-highlight"
              aria-hidden="true"
              style={{
                height: highlight.height,
                opacity: highlight.height ? 1 : 0,
                transform: `translateY(${highlight.top}px)`,
              }}
            />
            {visible.map((option, index) => {
              const showGroup =
                groupCount > 1 &&
                option.group &&
                option.group !== visible[index - 1]?.group;
              const isSelected = selected.includes(option.value);
              return (
                <Fragment key={option.value}>
                  {showGroup ? (
                    <div className="dropdown-group" role="presentation">
                      {option.group}
                    </div>
                  ) : null}
                  <div
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    className="dropdown-option"
                    data-index={index}
                    data-active={index === activeIndex}
                    data-sound="select"
                    onPointerMove={() => {
                      if (!option.disabled && index !== activeIndex) {
                        setActiveIndex(index);
                      }
                    }}
                    // Keep focus where it is, so the click cannot blur the list.
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => dropdown.pick(option)}
                  >
                    <span className="dropdown-option-text">
                      <span className="dropdown-option-label">
                        {option.label}
                      </span>
                      {option.detail ? (
                        <span className="dropdown-option-detail">
                          {option.detail}
                        </span>
                      ) : null}
                    </span>
                    <CheckIcon
                      size={12}
                      weight="bold"
                      className="dropdown-check"
                      data-visible={isSelected}
                      aria-hidden="true"
                    />
                  </div>
                </Fragment>
              );
            })}
            {visible.length === 0 ? (
              <p className="dropdown-empty">No matches.</p>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  containerClassName?: string;
};

/**
 * A custom dropdown over a real `<select>`. The native element stays focused
 * and carries the name, value, label, and change event, so forms, screen
 * readers, and tests see an ordinary select. The trigger and panel are visual.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      className = "",
      containerClassName = "",
      disabled,
      children,
      value,
      defaultValue,
      onChange,
      ...props
    },
    ref,
  ) {
    const selectRef = useRef<HTMLSelectElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listId = useId();
    useImperativeHandle(ref, () => selectRef.current as HTMLSelectElement);

    const options = useMemo(() => optionsFromChildren(children), [children]);
    const [nativeValue, setNativeValue] = useState<string | undefined>(
      defaultValue === undefined ? undefined : String(defaultValue),
    );
    const current =
      (value === undefined ? nativeValue : String(value)) ?? options[0]?.value;
    const currentLabel =
      options.find((option) => option.value === current)?.label ?? "";

    // The browser picks a new value by itself when an uncontrolled select's
    // options change, so the trigger follows whatever the element now holds.
    useLayoutEffect(() => {
      const element = selectRef.current;
      if (element && value === undefined && element.value !== nativeValue) {
        setNativeValue(element.value);
      }
    }, [nativeValue, options, value]);

    const dropdown = useDropdown({
      options,
      selected: current === undefined ? [] : [current],
      closeOnPick: true,
      onPick(next) {
        const element = selectRef.current;
        if (!element || element.value === next) return;
        // Assign through the prototype and dispatch a real event, so React
        // reports this exactly as it would a native selection.
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )?.set?.call(element, next);
        element.dispatchEvent(new Event("change", { bubbles: true }));
      },
      onClosed: () => selectRef.current?.focus(),
    });

    return (
      <span
        className={`select-control ${className} ${containerClassName}`.trim()}
        data-disabled={disabled ? "true" : undefined}
      >
        <select
          ref={selectRef}
          className="app-select select-native"
          disabled={disabled}
          value={value}
          defaultValue={defaultValue}
          aria-expanded={dropdown.open}
          aria-controls={dropdown.open ? listId : undefined}
          aria-activedescendant={
            dropdown.open && dropdown.activeIndex >= 0
              ? `${listId}-${dropdown.activeIndex}`
              : undefined
          }
          onChange={(event) => {
            setNativeValue(event.target.value);
            onChange?.(event);
          }}
          onKeyDown={dropdown.handleKeyDown}
          {...props}
        >
          {children}
        </select>
        <button
          ref={triggerRef}
          type="button"
          className="select-trigger"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          data-open={dropdown.open}
          // Focus belongs on the native select, not this visual button.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            selectRef.current?.focus();
            if (dropdown.open) dropdown.close();
            else dropdown.openList();
          }}
        >
          <span className="select-trigger-label">{currentLabel}</span>
          <CaretUpDownIcon
            className="select-control-icon"
            size={12}
            aria-hidden="true"
          />
        </button>
        {dropdown.everOpened ? (
          <DropdownPanel
            anchorRef={triggerRef}
            listId={listId}
            multiple={false}
            selected={current === undefined ? [] : [current]}
            dropdown={dropdown}
          />
        ) : null}
      </span>
    );
  },
);

/** Several values from one dropdown; the panel stays open while choosing. */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  disabled,
  placeholder = "None selected",
}: {
  label: string;
  options: DropdownOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const dropdown = useDropdown({
    options,
    selected,
    closeOnPick: false,
    onPick(value) {
      onChange(
        selected.includes(value)
          ? selected.filter((item) => item !== value)
          : [...selected, value],
      );
    },
    onClosed: () => triggerRef.current?.focus(),
  });
  const chosen = options.filter((option) => selected.includes(option.value));
  const summary =
    chosen.length > 2
      ? `${chosen[0].label}, ${chosen[1].label}, ${chosen.length - 2} more`
      : chosen.map((option) => option.label).join(", ");

  return (
    <span className="select-control" data-disabled={disabled ? "true" : undefined}>
      <button
        ref={triggerRef}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={dropdown.open}
        aria-controls={dropdown.open ? listId : undefined}
        aria-activedescendant={
          dropdown.open && dropdown.activeIndex >= 0
            ? `${listId}-${dropdown.activeIndex}`
            : undefined
        }
        disabled={disabled}
        data-open={dropdown.open}
        onClick={() => {
          if (dropdown.open) dropdown.close();
          else dropdown.openList();
        }}
        onKeyDown={dropdown.handleKeyDown}
      >
        <span
          className="select-trigger-label"
          data-placeholder={chosen.length === 0}
        >
          {summary || placeholder}
        </span>
        <CaretUpDownIcon
          className="select-control-icon"
          size={12}
          aria-hidden="true"
        />
      </button>
      {dropdown.everOpened ? (
        <DropdownPanel
          anchorRef={triggerRef}
          listId={listId}
          label={label}
          multiple
          selected={selected}
          dropdown={dropdown}
        />
      ) : null}
    </span>
  );
}
