import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  getBundleDisplayName,
  shareTagline,
  shareUseCases,
  sharePreviewItems,
  shareDestinationKind,
  shareDestinationLabel,
  shareKindLabel,
} from "../shared/share-bundle.js";

const STEPS = ["reveal", "useCases", "preview", "cta"];
const AUTO_MS = { reveal: 1400, useCases: 2200, preview: 1800 };

export default function ShareWelcomeOverlay({ bundle, railRef, canvasRef, onAccept, onDismiss }) {
  const [step, setStep] = useState("reveal");
  const [stepVisible, setStepVisible] = useState(false);
  const [flying, setFlying] = useState(false);
  const [flyStyle, setFlyStyle] = useState(null);
  const cardRef = useRef(null);
  const acceptedRef = useRef(false);

  const name = getBundleDisplayName(bundle);
  const tagline = shareTagline(bundle);
  const useCases = shareUseCases(bundle);
  const preview = sharePreviewItems(bundle);
  const dest = shareDestinationKind(bundle);
  const destLabel = shareDestinationLabel(bundle);
  const kindLabel = shareKindLabel(bundle);
  const stepIdx = STEPS.indexOf(step);

  useEffect(() => {
    requestAnimationFrame(() => setStepVisible(true));
  }, []);

  const advance = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx >= STEPS.length - 1 || flying) return;
    setStepVisible(false);
    setTimeout(() => {
      setStep(STEPS[idx + 1]);
      requestAnimationFrame(() => setStepVisible(true));
    }, 180);
  }, [step, flying]);

  useEffect(() => {
    if (step === "cta" || flying) return;
    const ms = AUTO_MS[step];
    if (!ms) return;
    const t = setTimeout(advance, ms);
    return () => clearTimeout(t);
  }, [step, flying, advance]);

  function getFlyTarget() {
    const card = cardRef.current;
    if (!card) return null;
    const cardRect = card.getBoundingClientRect();
    let targetRect;

    if (dest === "canvas" && canvasRef?.current) {
      targetRect = canvasRef.current.getBoundingClientRect();
    } else if (railRef?.current) {
      const rail = railRef.current;
      const scroll = rail.querySelector(".rail-scroll");
      targetRect = scroll ? scroll.getBoundingClientRect() : rail.getBoundingClientRect();
    } else {
      return null;
    }

    const targetX =
      dest === "canvas"
        ? targetRect.left + targetRect.width / 2 - cardRect.width / 2
        : targetRect.left + targetRect.width / 2 - cardRect.width / 2;
    const targetY =
      dest === "canvas"
        ? targetRect.top + targetRect.height / 2 - cardRect.height / 2
        : targetRect.top + 48;
    return {
      dx: targetX - cardRect.left,
      dy: targetY - cardRect.top,
      scale: dest === "canvas" ? 0.35 : 0.52,
    };
  }

  function handleAccept() {
    if (acceptedRef.current) return;
    acceptedRef.current = true;
    const card = cardRef.current;
    const fly = getFlyTarget();
    if (!fly || !card) {
      onAccept();
      return;
    }
    const rect = card.getBoundingClientRect();
    setFlying(true);
    setFlyStyle({
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      transform: "none",
      opacity: 1,
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFlyStyle({
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          transform: `translate(${fly.dx}px, ${fly.dy}px) scale(${fly.scale})`,
          opacity: 0.65,
        });
      });
    });
    setTimeout(() => onAccept(), 680);
  }

  function handleScrimClick(e) {
    if (flying || step === "cta") return;
    if (e.target.closest(".share-welcome-card") || e.target.closest(".share-welcome-actions")) return;
    advance();
  }

  const ctaQuestion =
    dest === "structures"
      ? "Add to your structures?"
      : dest === "canvas"
        ? "Add to your canvas?"
        : "Add to your laboratory?";

  return (
    <div className={"share-welcome-scrim" + (flying ? " flying" : "")} onClick={handleScrimClick}>
      <div className="share-welcome-dust" aria-hidden="true" />

      {!flying && (
        <div className={"share-welcome" + (stepVisible ? " visible" : "")}>
          {step === "reveal" && (
            <div className="share-welcome-step reveal">
              <span className="share-welcome-kind">{kindLabel}</span>
              <h2 className="share-welcome-name">{name}</h2>
              <p className="share-welcome-tagline">{tagline}</p>
            </div>
          )}

          {step === "useCases" && (
            <div className="share-welcome-step use-cases">
              <p className="share-welcome-lead">Great for</p>
              <ul className="share-welcome-list">
                {useCases.map((line, i) => (
                  <li key={i} style={{ animationDelay: `${i * 0.12}s` }}>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step === "preview" && (
            <div className="share-welcome-step preview">
              <p className="share-welcome-lead">{preview.length > 1 ? "Move chain" : "Preview"}</p>
              <div className="share-welcome-pipeline">
                {preview.map((item, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="share-welcome-arrow" aria-hidden="true">→</span>}
                    <span className="share-welcome-chip" style={{ animationDelay: `${i * 0.1}s` }}>
                      {item}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {step === "cta" && (
            <div className="share-welcome-step cta">
              <p className="share-welcome-cta-q">{ctaQuestion}</p>
              <p className="share-welcome-cta-hint">
                It will land in your {destLabel} — ready to use on your board.
              </p>
              <div className="share-welcome-actions">
                <button type="button" className="share-welcome-add" onClick={handleAccept}>
                  Add it
                </button>
                <button type="button" className="share-welcome-skip" onClick={onDismiss}>
                  Just browse
                </button>
              </div>
            </div>
          )}

          {step !== "cta" && (
            <div className="share-welcome-progress">
              {STEPS.map((s, i) => (
                <span key={s} className={"share-welcome-dot" + (i <= stepIdx ? " on" : "") + (i === stepIdx ? " current" : "")} />
              ))}
            </div>
          )}
        </div>
      )}

      <div
        ref={cardRef}
        className={"share-welcome-card" + (flying ? " fly" : "") + (step === "cta" || flying ? " show" : "")}
        style={flyStyle || undefined}
      >
        <span className="share-welcome-card-kind">{kindLabel}</span>
        <span className="share-welcome-card-name">{name}</span>
        {preview.length > 0 && (
          <span className="share-welcome-card-meta">
            {preview.length === 1 ? preview[0] : `${preview.length} moves`}
          </span>
        )}
      </div>
    </div>
  );
}
