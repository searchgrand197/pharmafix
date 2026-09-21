import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import api from '../api';
import toast from 'react-hot-toast';
import { ArrowLeft, Send, Save, Eye, Check, PlusSquare, Trash2 } from 'lucide-react';

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const BLOCKS = [
  { type: "header", label: "Header" },
  { type: "title", label: "Title" },
  { type: "paragraph", label: "Paragraph" },
  { type: "section_card", label: "Section Card" },
  { type: "salary_table", label: "Salary Table" },
  { type: "terms_block", label: "Terms Block" },
  { type: "signature", label: "Signature" },
  { type: "image", label: "Logo / Image" },
  { type: "bullet_points", label: "Bullet Points" }
];

const DraggableBlock = ({ block, disabled }) => {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `new-${block.type}`,
    data: block,
    disabled: disabled
  });
  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`p-3 mb-2 bg-white border rounded shadow-sm ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-grab hover:bg-gray-50'}`}
    >
      {block.label}
    </div>
  );
};

const parsePx = (value) => {
  if (typeof value === 'number') return value;
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : 0;
};

const CanvasBlock = ({ block, selectedBlock, setSelectedBlock, onUpdateBlock, isLayoutLocked, renderBlock }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: block.id,
  });

  return (
    <div
      ref={setNodeRef}
      onClick={() => setSelectedBlock(block)}
      className={`relative mb-2 transition-all ${isOver ? 'border-t-2 border-indigo-500 pt-2' : ''} ${isLayoutLocked ? '' : 'cursor-pointer hover:ring-1 hover:ring-indigo-200'} ${selectedBlock?.id === block.id && !isLayoutLocked ? 'ring-2 ring-indigo-500' : ''}`}
    >
      {renderBlock(block)}
      {!isLayoutLocked && selectedBlock?.id === block.id && (
        <div className="absolute -right-8 top-0 flex flex-col gap-1">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onUpdateBlock(block.id, { isDeleted: true });
            }} 
            className="bg-red-500 text-white p-1 rounded-full hover:bg-red-600"
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
};

const DroppableCanvas = ({ blocks, selectedBlock, setSelectedBlock, onUpdateBlock, isLayoutLocked }) => {
  const { isOver, setNodeRef } = useDroppable({
    id: 'canvas',
  });

  const startImageDrag = (block, event) => {
    if (isLayoutLocked) return;
    event.preventDefault();
    event.stopPropagation();

    const startMouseX = event.clientX;
    const startMouseY = event.clientY;
    const startX = parsePx(block.data?.x);
    const startY = parsePx(block.data?.y);

    const onMouseMove = (moveEvent) => {
      const dx = moveEvent.clientX - startMouseX;
      const dy = moveEvent.clientY - startMouseY;
      onUpdateBlock(block.id, {
        x: `${Math.round(startX + dx)}px`,
        y: `${Math.round(startY + dy)}px`,
      });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const renderBlock = (block) => {
    const textStyle = {
      fontSize: block.data?.font_size || undefined,
      color: block.data?.text_color || undefined,
      textAlign: block.data?.align || undefined,
      marginBottom: isLayoutLocked ? '20px' : undefined
    };

    const handleInlineEdit = (e, field, index = null) => {
      e.stopPropagation();
      const newValue = e.target.innerText;
      if (index !== null) {
        const newItems = [...block.data[field]];
        newItems[index] = newValue;
        onUpdateBlock(block.id, { [field]: newItems });
      } else {
        onUpdateBlock(block.id, { [field]: newValue });
      }
    };

    const handleItemEdit = (e, index, subField) => {
      e.stopPropagation();
      const newValue = e.target.innerText;
      const newItems = block.data.items.map((item, i) => 
        i === index ? { ...item, [subField]: newValue } : item
      );
      onUpdateBlock(block.id, { items: newItems });
    };

    switch(block.type) {
      case "header":
        return (
          <div className={`${isLayoutLocked ? 'text-left' : 'text-right'} mb-4 flex justify-between items-start`}>
            <div>
              {block.data.logo_url && (
                <img src={block.data.logo_url} className="h-16 mb-2 object-contain" alt="Logo" />
              )}
              <strong 
                className="block whitespace-pre-line outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded" 
                style={textStyle}
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => handleInlineEdit(e, 'company_name')}
              >
                {block.data.company_name || '{{company_name}}'}
              </strong>
            </div>
            {block.data.date && (
              <div className="text-sm text-gray-600 mt-1">
                Date: <span
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => handleInlineEdit(e, 'date')}
                  className="outline-none focus:ring-1 focus:ring-indigo-300"
                >{block.data.date}</span>
              </div>
            )}
          </div>
        );
      case "title":
        return (
          <div 
            className="text-center text-2xl font-bold my-4 outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded uppercase tracking-wide" 
            style={textStyle}
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => handleInlineEdit(e, 'text')}
          >
            {block.data.text || 'Offer Letter'}
          </div>
        );
      case "paragraph":
        return (
          <div 
            className="mb-4 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded"
            style={textStyle}
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => handleInlineEdit(e, 'text')}
          >
            {block.data.text || 'Enter paragraph text here...'}
          </div>
        );
      case "section_card":
        return (
          <div className="border border-gray-300 p-4 mb-4 rounded bg-gray-50 shadow-sm" style={textStyle}>
            <div 
              className="font-bold mb-2 text-indigo-900 border-b pb-1 outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded inline-block"
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => handleInlineEdit(e, 'title')}
            >
              {block.data.title || 'Section Title'}
            </div>
            {(block.data.items || []).map((item, idx) => (
              <p key={idx} className="my-1">
                <strong
                  className="outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => handleItemEdit(e, idx, 'label')}
                >
                  {item.label}
                </strong>: 
                <span
                  className="ml-1 outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => handleItemEdit(e, idx, 'value')}
                >
                  {item.value}
                </span>
              </p>
            ))}
          </div>
        );
      case "salary_table":
        return (
          <div className="mb-6" style={textStyle}>
            {block.data.title && <div className="font-bold mb-2 text-indigo-900">{block.data.title}</div>}
            <table className="w-full border-collapse border border-gray-300 text-sm">
              <thead className="bg-gray-100">
                <tr>
                  {(block.data.columns || []).map((col, idx) => (
                    <th key={idx} className="border p-2 text-left">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(block.data.rows || []).map((row, rIdx) => (
                  <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    {row.map((cell, cIdx) => (
                      <td 
                        key={cIdx} 
                        className="border p-2 outline-none focus:ring-1 focus:ring-indigo-300"
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(e) => {
                          const newRows = [...block.data.rows];
                          newRows[rIdx] = [...newRows[rIdx]];
                          newRows[rIdx][cIdx] = e.target.innerText;
                          onUpdateBlock(block.id, { rows: newRows });
                        }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "terms_block":
        return (
          <div className="mb-6 p-4 bg-gray-50 border-l-4 border-indigo-500 rounded text-sm italic text-gray-700" style={textStyle}>
            <div 
              className="outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded whitespace-pre-wrap"
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => handleInlineEdit(e, 'content')}
            >
              {block.data.content || 'Terms and conditions...'}
            </div>
          </div>
        );
      case "signature":
        return (
          <div className="mt-8 flex justify-between items-end" style={textStyle}>
            <div className="w-1/2">
              <p className="text-sm text-gray-600 mb-2">
                For <span
                  className="outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => handleInlineEdit(e, 'company_name')}
                >
                  {block.data.company_name || '{{company_name}}'}
                </span>
              </p>
              {block.data.signature_url ? (
                <img src={block.data.signature_url} className="h-12 mb-2 object-contain" alt="Signature" />
              ) : (
                <div className={`h-12 mb-2 flex items-center justify-center border-2 border-dashed border-gray-200 text-gray-400 text-xs rounded ${isLayoutLocked ? '' : 'hover:border-indigo-300 cursor-pointer'}`}>
                  {isLayoutLocked ? 'No Signature Uploaded' : 'Click to Upload Signature'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const url = await fileToDataUrl(file);
                        onUpdateBlock(block.id, { signature_url: url });
                      }
                    }}
                  />
                </div>
              )}
              <div className="h-px bg-gray-400 w-48 mb-2"></div>
              <p 
                className="font-bold text-sm outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded"
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => handleInlineEdit(e, 'hr_name')}
              >
                {block.data.hr_name || '{{hr_name}}'}
              </p>
              <p 
                className="text-xs text-gray-500 outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded"
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => handleInlineEdit(e, 'designation')}
              >
                {block.data.designation || '{{hr_designation}}'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 mb-8 italic">Accepted By Candidate</p>
              <div className="h-px bg-gray-400 w-48 mb-2 ml-auto"></div>
              <p 
                className="font-bold text-sm outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded"
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => handleInlineEdit(e, 'candidate_name')}
              >
                {block.data.candidate_name || '{{candidate_name}}'}
              </p>
            </div>
          </div>
        );
      case "image":
        return (
          <div className="mb-4" style={{ textAlign: block.data.align || 'center' }}>
            {block.data.url ? (
              <img
                src={block.data.url}
                style={{
                  width: block.data.width || '180px',
                  height: block.data.height || '80px',
                  objectFit: 'contain',
                  transform: isLayoutLocked ? 'none' : `translate(${block.data.x || '0px'}, ${block.data.y || '0px'})`,
                  cursor: isLayoutLocked ? 'default' : 'grab',
                  userSelect: 'none',
                }}
                alt="Logo"
                onMouseDown={(e) => startImageDrag(block, e)}
              />
            ) : (
              <div className="text-gray-400 border p-4 inline-block bg-gray-50 rounded">Image Placeholder (Add URL)</div>
            )}
          </div>
        );
      case "bullet_points":
        return (
          <div className="mb-2" style={textStyle}>
            {block.data.title && (
              <div 
                className="font-bold mb-1 outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded inline-block"
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => handleInlineEdit(e, 'title')}
              >
                {block.data.title}
              </div>
            )}
            <ul className="list-disc pl-5">
              {(block.data.items || []).map((item, idx) => (
                <li 
                  key={idx}
                  className="outline-none focus:ring-1 focus:ring-indigo-300 px-1 rounded"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => handleInlineEdit(e, 'items', idx)}
                >
                  {item || 'Empty Point'}
                </li>
              ))}
            </ul>
          </div>
        );
      default:
        return <div>Unknown Block</div>;
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[842px] w-[595px] mx-auto border shadow-lg p-12 transition-all ${isOver ? 'bg-indigo-50 border-indigo-300' : 'bg-white border-gray-200'} ${isLayoutLocked ? 'cursor-default' : ''}`}
      style={{ 
        boxSizing: 'border-box',
        overflowY: 'auto'
      }}
    >
      {blocks.length === 0 ? (
        <div className="text-center text-gray-400 mt-20">Drag blocks here or start from a template</div>
      ) : (
        blocks.map(block => (
          <CanvasBlock
            key={block.id}
            block={block}
            selectedBlock={selectedBlock}
            setSelectedBlock={setSelectedBlock}
            onUpdateBlock={onUpdateBlock}
            isLayoutLocked={isLayoutLocked}
            renderBlock={renderBlock}
          />
        ))
      )}
    </div>
  );
};

export default function OfferTemplateBuilder() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryParams = new URLSearchParams(location.search);
  const offerId = queryParams.get('offer_id');

  const [blocks, setBlocks] = useState([]);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [templateName, setTemplateName] = useState("New Template");
  const [previewHtml, setPreviewHtml] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [loading, setLoading] = useState(false);
  const [offerData, setOfferData] = useState(null);
  const [isLayoutLocked, setIsLayoutLocked] = useState(true);

  const PROFESSIONAL_TEMPLATE = {
    name: "Professional Offer Letter",
    is_layout_locked: true,
    design_json: {
      blocks: [
        { 
          type: "header", 
          data: { 
            company_name: "Curevice Pvt Ltd", 
            logo_url: "", 
            date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
          } 
        },
        { 
          type: "title", 
          data: { text: "Letter of Offer" } 
        },
        { 
          type: "paragraph", 
          data: { text: "Dear {{candidate_name}}," } 
        },
        { 
          type: "paragraph", 
          data: { text: "With reference to your application and subsequent interview you had with us, we are pleased to offer you the position of {{job_title}} at {{company_name}}." } 
        },
        { 
          type: "section_card", 
          data: { 
            title: "Appointment Details",
            items: [
              { label: "Designation", value: "{{job_title}}" },
              { label: "Department", value: "{{department}}" },
              { label: "Location", value: "{{job_location}}" },
              { label: "Joining Date", value: "{{joining_date}}" },
              { label: "Last Date to Accept", value: "{{offer_expiry_date}}" }
            ]
          } 
        },
        { 
          type: "salary_table", 
          data: { 
            title: "Compensation Details (Annual)",
            columns: ["Component", "Amount (INR)"], 
            rows: [ 
              ["Basic Salary", "{{basic_salary}}"], 
              ["HRA", "{{hra}}"],
              ["Special Allowance", "{{allowances}}"],
              ["Performance Bonus", "{{bonus}}"], 
              ["Total CTC", "{{ctc}}"] 
            ] 
          } 
        },
        { 
          type: "terms_block", 
          data: { 
            content: "This offer is contingent upon successful completion of background verification and submission of valid documents. Your employment will be governed by the company's rules and regulations as applicable from time to time." 
          } 
        },
        { 
          type: "signature", 
          data: { 
            hr_name: "{{hr_name}}", 
            designation: "{{hr_designation}}", 
            company_name: "{{company_name}}"
          } 
        } 
      ] 
    }
  };

  useEffect(() => {
    if (offerId) {
      fetchOfferDetails();
    } else {
      loadTemplate(true);
    }
  }, [offerId]);

  const makeProfessional = () => {
    setIsLayoutLocked(true);
    setBlocks(PROFESSIONAL_TEMPLATE.design_json.blocks.map((b, i) => ({
      ...b,
      id: `prof-${Date.now()}-${i}`
    })));
    toast.success("Applied professional formatting!");
  };

  const fetchOfferDetails = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/hr/offers/${offerId}/`);
      const offer = res.data;
      setOfferData(offer);
      
      // If the offer already has edited layout config with blocks, use them
      if (offer.edited_layout_config && offer.edited_layout_config.blocks) {
        const loadedBlocks = offer.edited_layout_config.blocks.map((b, i) => ({
          ...b,
          id: b.id || `offer-${Date.now()}-${i}`
        }));
        setBlocks(loadedBlocks);
        setIsLayoutLocked(!!offer.edited_layout_config.is_layout_locked);
      } 
      // Otherwise load blocks from the component template
      else if (offer.component_template_details?.design_json?.blocks) {
        const loadedBlocks = offer.component_template_details.design_json.blocks.map((b, i) => ({
          ...b,
          id: b.id || `loaded-${Date.now()}-${i}`
        }));
        setBlocks(loadedBlocks);
        setIsLayoutLocked(!!offer.component_template_details.is_layout_locked);
      }
      
      setTemplateName(`Offer for ${offer.candidate_name}`);
    } catch (err) {
      console.error("Failed to load offer details", err);
      toast.error("Failed to load offer details");
    } finally {
      setLoading(false);
    }
  };

  const loadTemplate = async (isInitialLoad = false) => {
    try {
      const res = await api.get('/hr/component-templates/');
      if (res.data) {
        const dataArray = Array.isArray(res.data) ? res.data : (res.data.results || []);
        const filteredTemplates = dataArray.filter(t => {
          const name = (t?.name || '').toLowerCase().trim();
          return (
            !name.includes('tcs professional sample letter') &&
            !name.includes('tcs style professional offer letter')
          );
        });
        setTemplates(filteredTemplates);
        
        if (isInitialLoad && filteredTemplates.length > 0) {
          const targetTemplate = filteredTemplates[0];
          const loadedBlocks = (targetTemplate.design_json?.blocks || []).map((b, i) => ({
            ...b,
            id: b.id || `loaded-${Date.now()}-${i}`
          }));
          setBlocks(loadedBlocks);
          setTemplateName(targetTemplate.name);
          setSelectedTemplateId(targetTemplate.id);
        }
      }
    } catch (err) {
      console.error("Failed to load templates", err);
    }
  };

  useEffect(() => {
    loadTemplate(true);
  }, []);

  const handleTemplateChange = (e) => {
    const tId = e.target.value;
    if (!tId) {
      // New Template
      setSelectedTemplateId("");
      setTemplateName("New Template");
      setBlocks([]);
      setSelectedBlock(null);
      setIsLayoutLocked(false);
      return;
    }
    
    if (tId === 'prof-default') {
      setSelectedTemplateId("prof-default");
      setTemplateName("Professional Offer Letter");
      setBlocks(PROFESSIONAL_TEMPLATE.design_json.blocks.map((b, i) => ({
        ...b,
        id: `prof-${Date.now()}-${i}`
      })));
      setIsLayoutLocked(true);
      setSelectedBlock(null);
      return;
    }

    setSelectedTemplateId(tId);
    const selected = templates.find(t => t.id === tId);
    if (selected) {
      setTemplateName(selected.name);
      const loadedBlocks = (selected.design_json?.blocks || []).map((b, i) => ({
        ...b,
        id: b.id || `loaded-${Date.now()}-${i}`
      }));
      setBlocks(loadedBlocks);
      setIsLayoutLocked(!!selected.is_layout_locked);
      setSelectedBlock(null);
    }
  };

  const deleteTemplate = async () => {
    if (!selectedTemplateId || selectedTemplateId === 'prof-default') {
      toast.error("Cannot delete this template");
      return;
    }

    if (!window.confirm(`Are you sure you want to delete the template "${templateName}"?`)) {
      return;
    }

    try {
      await api.delete(`/hr/component-templates/${selectedTemplateId}/`);
      toast.success("Template deleted successfully");
      
      // Reset state
      setSelectedTemplateId("");
      setTemplateName("New Template");
      setBlocks([]);
      setSelectedBlock(null);
      setIsLayoutLocked(false);
      
      // Refresh list
      loadTemplate(false);
    } catch (err) {
      console.error("Failed to delete template", err);
      toast.error("Error deleting template");
    }
  };

  const saveTemplate = async () => {
    try {
      if (offerId) {
        const resPreview = await api.post('/hr/component-templates/render_preview/', {
          blocks,
          ...(offerData ? {
            company_name: offerData.company_name,
            candidate_name: offerData.candidate_name,
            job_title: offerData.job_title,
            job_location: offerData.job_location,
            joining_date: offerData.joining_date,
            ctc: offerData.ctc,
            hr_name: offerData.hr_name,
            hr_designation: offerData.hr_designation,
          } : {})
        });
        
        await api.post(`/hr/offers/${offerId}/update_preview_content/`, {
          html: resPreview.data.html,
          layout_config: { blocks, is_layout_locked: isLayoutLocked }
        });
        toast.success('Offer draft saved successfully!');
        return;
      }

      const payload = {
        name: templateName,
        design_json: { blocks },
        is_layout_locked: isLayoutLocked
      };

      if (selectedTemplateId && selectedTemplateId !== 'prof-default') {
        await api.put(`/hr/component-templates/${selectedTemplateId}/`, payload);
        toast.success('Template updated successfully!');
      } else {
        const res = await api.post('/hr/component-templates/', payload);
        setSelectedTemplateId(res.data.id);
        toast.success('New template saved successfully!');
      }
      loadTemplate(false); 
    } catch (err) {
      console.error("Failed to save", err);
      toast.error('Error saving');
    }
  };

  const sendOffer = async () => {
    if (!offerId) return;
    if (!window.confirm("Are you sure you want to send this offer to the candidate?")) return;

    try {
      const resPreview = await api.post('/hr/component-templates/render_preview/', {
        blocks,
        ...(offerData ? {
          company_name: offerData.company_name,
          candidate_name: offerData.candidate_name,
          job_title: offerData.job_title,
          job_location: offerData.job_location,
          joining_date: offerData.joining_date,
          ctc: offerData.ctc,
          hr_name: offerData.hr_name,
          hr_designation: offerData.hr_designation,
        } : {})
      });
      
      await api.post(`/hr/offers/${offerId}/update_preview_content/`, {
        html: resPreview.data.html,
        layout_config: { blocks }
      });

      // Then send the offer
      const resSend = await api.post(`/hr/offers/${offerId}/send/`);
      if (resSend.data.success) {
        toast.success('Offer sent successfully!');
        const builderReturnTo = offerId
          ? `/hr/builder?offer_id=${offerId}`
          : '/hr/builder';
        navigate(`/hr/candidates/${offerData.candidate}`, {
          state: { returnTo: builderReturnTo },
        });
      } else {
        toast.error(resSend.data.error || 'Failed to send offer');
      }
    } catch (err) {
      console.error("Failed to send offer", err);
      toast.error('Error sending offer');
    }
  };

  const previewTemplate = async () => {
    try {
      const context = offerData ? {
        company_name: offerData.company_name,
        candidate_name: offerData.candidate_name,
        job_title: offerData.job_title,
        job_location: offerData.job_location,
        joining_date: offerData.joining_date,
        ctc: offerData.ctc,
        hr_name: offerData.hr_name,
        hr_designation: offerData.hr_designation,
      } : {
        company_name: "Curevice Pvt Ltd",
        candidate_name: "John Doe",
        job_title: "Software Engineer",
        job_location: "Delhi",
        joining_date: "10 May 2026",
        ctc: "6,00,000",
        hr_name: "Jane Smith"
      };

      const res = await api.post('/hr/component-templates/render_preview/', {
        blocks,
        ...context
      });
      setPreviewHtml(res.data.html);
      setShowPreview(true);
    } catch (err) {
      console.error("Preview failed", err);
    }
  };

  const savePreviewChanges = async (newHtml) => {
    setPreviewHtml(newHtml);
  };

  const handleDragEnd = (event) => {
    const { over, active } = event;
    if (!over) return;

    if (active.id.startsWith('new-')) {
      const type = active.data.current.type;
      const newBlock = { 
        id: `block-${Date.now()}`, 
        type, 
        data: {} 
      };
      
      // Initialize default data for blocks
      if (type === 'header') newBlock.data = { company_name: "{{company_name}}", date: new Date().toLocaleDateString('en-GB') };
      if (type === 'title') newBlock.data = { text: "Offer Letter" };
      if (type === 'paragraph') newBlock.data = { text: "Enter your text here..." };
      if (type === 'section_card') newBlock.data = { title: "Section", items: [{label: "Label", value: "Value"}] };
      if (type === 'salary_table') newBlock.data = { title: "Compensation", columns: ["Component", "Amount"], rows: [["Basic", "0.00"]] };
      if (type === 'terms_block') newBlock.data = { content: "Terms and conditions..." };
      if (type === 'signature') newBlock.data = { hr_name: "{{hr_name}}", designation: "{{hr_designation}}", company_name: "{{company_name}}" };
      if (type === 'table') newBlock.data = { title: "Table", columns: ["Col1", "Col2"], rows: [["Val1", "Val2"]] };
      if (type === 'image') newBlock.data = { url: "", align: "center", width: "180px", height: "80px", x: "0px", y: "0px" };
      if (type === 'bullet_points') newBlock.data = { title: "Points", items: ["Point 1"] };
      
      // Support insertion at specific position or reordering
      if (over.id !== 'canvas') {
        const overIndex = blocks.findIndex(b => b.id === over.id);
        const newBlocks = [...blocks];
        newBlocks.splice(overIndex + 1, 0, newBlock);
        setBlocks(newBlocks);
      } else {
        setBlocks(prev => [...prev, newBlock]);
      }
      setSelectedBlock(newBlock);
    } else {
      // Reordering existing blocks
      const oldIndex = blocks.findIndex(b => b.id === active.id);
      const newIndex = blocks.findIndex(b => b.id === over.id);
      
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const newBlocks = [...blocks];
        const [removed] = newBlocks.splice(oldIndex, 1);
        newBlocks.splice(newIndex, 0, removed);
        setBlocks(newBlocks);
      }
    }
  };

  const updateSelectedBlock = (newData) => {
    if (!selectedBlock) return;

    setBlocks(prevBlocks =>
      prevBlocks.map(b =>
        b.id === selectedBlock.id ? { ...b, data: { ...b.data, ...newData } } : b
      )
    );
    setSelectedBlock(prevSelected =>
      prevSelected ? { ...prevSelected, data: { ...prevSelected.data, ...newData } } : prevSelected
    );
  };

  const updateBlockById = (blockId, newData) => {
    if (newData.isDeleted) {
      setBlocks(prev => prev.filter(b => b.id !== blockId));
      setSelectedBlock(null);
      return;
    }
    setBlocks(prevBlocks =>
      prevBlocks.map(b =>
        b.id === blockId ? { ...b, data: { ...b.data, ...newData } } : b
      )
    );
    setSelectedBlock(prevSelected =>
      prevSelected && prevSelected.id === blockId
        ? { ...prevSelected, data: { ...prevSelected.data, ...newData } }
        : prevSelected
    );
  };

  const renderSettings = () => {
    if (!selectedBlock) return <p className="text-gray-500">Select a block to edit</p>;
    
    return (
      <div className="space-y-4">
        <div className="font-bold border-b pb-2 flex justify-between items-center">
          <span>Edit {selectedBlock.type}</span>
          <button onClick={() => setSelectedBlock(null)} className="text-gray-400 hover:text-gray-600">&times;</button>
        </div>
        
        {selectedBlock.type === 'header' && (
          <div>
            <label className="block text-sm font-medium">Company Logo</label>
            <input
              type="file"
              accept="image/*"
              className="mt-1 w-full border rounded p-2 text-xs"
              onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const url = await fileToDataUrl(file);
                  updateSelectedBlock({ logo_url: url });
                } catch (err) {
                  toast.error("Failed to upload logo");
                }
              }}
            />
            {selectedBlock.data.logo_url && (
              <button 
                onClick={() => updateSelectedBlock({ logo_url: null })}
                className="mt-1 text-red-500 text-xs"
              >
                Remove Logo
              </button>
            )}
            <label className="block text-sm font-medium mt-3">Company Name</label>
            <textarea
              rows={2}
              className="mt-1 w-full border rounded p-2 text-sm"
              value={selectedBlock.data.company_name || ''}
              onChange={e => updateSelectedBlock({ company_name: e.target.value })}
            />
            <label className="block text-sm font-medium mt-2">Date</label>
            <input 
              type="text" 
              className="mt-1 w-full border rounded p-2 text-sm" 
              value={selectedBlock.data.date || ''} 
              onChange={e => updateSelectedBlock({ date: e.target.value })} 
            />
          </div>
        )}
        
        {selectedBlock.type === 'title' && (
          <div>
            <label className="block text-sm font-medium">Title Text</label>
            <input 
              type="text" 
              className="mt-1 w-full border rounded p-2 text-sm" 
              value={selectedBlock.data.text || ''} 
              onChange={e => updateSelectedBlock({ text: e.target.value })} 
            />
          </div>
        )}

        {selectedBlock.type === 'paragraph' && (
          <div>
            <label className="block text-sm font-medium">Content</label>
            <textarea 
              rows={5}
              className="mt-1 w-full border rounded p-2 text-sm" 
              value={selectedBlock.data.text || ''} 
              onChange={e => updateSelectedBlock({ text: e.target.value })} 
            />
          </div>
        )}

        {selectedBlock.type === 'section_card' && (
          <div>
            <label className="block text-sm font-medium">Section Title</label>
            <input 
              type="text" 
              className="mt-1 w-full border rounded p-2 mb-2 text-sm" 
              value={selectedBlock.data.title || ''} 
              onChange={e => updateSelectedBlock({ title: e.target.value })} 
            />
            <label className="block text-sm font-medium mt-2">Details</label>
            {(selectedBlock.data.items || []).map((item, idx) => (
              <div key={idx} className="flex space-x-2 mt-2 bg-gray-50 p-2 border rounded relative">
                <div className="flex-1">
                  <input type="text" placeholder="Label" className="w-full border rounded p-1 mb-1 text-xs font-medium" value={item.label} onChange={e => {
                    const newItems = selectedBlock.data.items.map((it, i) => i === idx ? { ...it, label: e.target.value } : it);
                    updateSelectedBlock({ items: newItems });
                  }}/>
                  <input type="text" placeholder="Value" className="w-full border rounded p-1 text-xs" value={item.value} onChange={e => {
                    const newItems = selectedBlock.data.items.map((it, i) => i === idx ? { ...it, value: e.target.value } : it);
                    updateSelectedBlock({ items: newItems });
                  }}/>
                </div>
                <button onClick={() => {
                  const newItems = selectedBlock.data.items.filter((_, i) => i !== idx);
                  updateSelectedBlock({ items: newItems });
                }} className="text-red-500 font-bold px-2 self-start">&times;</button>
              </div>
            ))}
            <button className="mt-2 text-indigo-600 text-xs font-medium" onClick={() => {
              const newItems = [...(selectedBlock.data.items || []), {label: 'New Label', value: 'New Value'}];
              updateSelectedBlock({ items: newItems });
            }}>+ Add Detail</button>
          </div>
        )}

        {selectedBlock.type === 'salary_table' && (
          <div>
            <label className="block text-sm font-medium">Table Title</label>
            <input 
              type="text" 
              className="mt-1 w-full border rounded p-2 mb-2 text-sm" 
              value={selectedBlock.data.title || ''} 
              onChange={e => updateSelectedBlock({ title: e.target.value })} 
            />
            <label className="block text-sm font-medium mt-2">Components (Rows)</label>
            {(selectedBlock.data.rows || []).map((row, rIdx) => (
              <div key={rIdx} className="flex gap-1 mt-2 items-center">
                <input type="text" className="flex-1 border rounded p-1 text-xs" value={row[0]} onChange={e => {
                  const newRows = [...selectedBlock.data.rows];
                  newRows[rIdx] = [e.target.value, row[1]];
                  updateSelectedBlock({ rows: newRows });
                }}/>
                <input type="text" className="w-24 border rounded p-1 text-xs" value={row[1]} onChange={e => {
                  const newRows = [...selectedBlock.data.rows];
                  newRows[rIdx] = [row[0], e.target.value];
                  updateSelectedBlock({ rows: newRows });
                }}/>
                <button onClick={() => {
                  const newRows = selectedBlock.data.rows.filter((_, i) => i !== rIdx);
                  updateSelectedBlock({ rows: newRows });
                }} className="text-red-500 font-bold px-1">&times;</button>
              </div>
            ))}
            <button className="mt-2 text-indigo-600 text-xs font-medium" onClick={() => {
              const newRows = [...(selectedBlock.data.rows || []), ['New Component', '0.00']];
              updateSelectedBlock({ rows: newRows });
            }}>+ Add Component</button>
          </div>
        )}

        {selectedBlock.type === 'terms_block' && (
          <div>
            <label className="block text-sm font-medium">Legal Content</label>
            <textarea 
              rows={8}
              className="mt-1 w-full border rounded p-2 text-sm" 
              value={selectedBlock.data.content || ''} 
              onChange={e => updateSelectedBlock({ content: e.target.value })} 
            />
          </div>
        )}

        {selectedBlock.type === 'signature' && (
          <div>
            <label className="block text-sm font-medium">Signatory Name</label>
            <input 
              type="text" 
              className="mt-1 w-full border rounded p-2 mb-2 text-sm" 
              value={selectedBlock.data.hr_name || ''} 
              onChange={e => updateSelectedBlock({ hr_name: e.target.value })} 
            />
            <label className="block text-sm font-medium">Signatory Designation</label>
            <input 
              type="text" 
              className="mt-1 w-full border rounded p-2 mb-2 text-sm" 
              value={selectedBlock.data.designation || ''} 
              onChange={e => updateSelectedBlock({ designation: e.target.value })} 
            />
            <label className="block text-sm font-medium">Upload Signature Image</label>
            <input
              type="file"
              accept="image/*"
              className="mt-1 w-full border rounded p-2 text-xs"
              onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const url = await fileToDataUrl(file);
                  updateSelectedBlock({ signature_url: url });
                } catch (err) {
                  toast.error("Failed to upload signature");
                }
              }}
            />
            {selectedBlock.data.signature_url && (
              <button 
                onClick={() => updateSelectedBlock({ signature_url: null })}
                className="mt-2 text-red-500 text-xs"
              >
                Remove Signature
              </button>
            )}
          </div>
        )}

        {selectedBlock.type === 'image' && (
          <div>
            <label className="block text-sm font-medium">Upload Image (Gallery)</label>
            <input
              type="file"
              accept="image/*"
              className="mt-1 w-full border rounded p-2 mb-2 text-sm"
              onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const dataUrl = await fileToDataUrl(file);
                  updateSelectedBlock({ url: dataUrl });
                } catch (err) {
                  console.error('Failed to read image file', err);
                } finally {
                  e.target.value = '';
                }
              }}
            />
            <label className="block text-sm font-medium">Or Paste Image URL (Optional)</label>
            <input
              type="text"
              className="mt-1 w-full border rounded p-2 mb-2 text-sm"
              placeholder="https://..."
              value={selectedBlock.data.url || ''}
              onChange={e => updateSelectedBlock({ url: e.target.value })}
            />
            <label className="block text-sm font-medium">Alignment</label>
            <select className="mt-1 w-full border rounded p-2 mb-2 text-sm" value={selectedBlock.data.align || 'center'} onChange={e => updateSelectedBlock({ align: e.target.value })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
            <label className="block text-sm font-medium">Width (e.g. 220px)</label>
            <input
              type="text"
              className="mt-1 w-full border rounded p-2 mb-2 text-sm"
              value={selectedBlock.data.width || ''}
              onChange={e => updateSelectedBlock({ width: e.target.value })}
            />
            <label className="block text-sm font-medium">Height (e.g. 100px)</label>
            <input
              type="text"
              className="mt-1 w-full border rounded p-2 text-sm"
              value={selectedBlock.data.height || ''}
              onChange={e => updateSelectedBlock({ height: e.target.value })}
            />
            <label className="block text-sm font-medium mt-2">X Offset</label>
            <input
              type="text"
              className="mt-1 w-full border rounded p-2 mb-2 text-sm"
              value={selectedBlock.data.x || '0px'}
              onChange={e => updateSelectedBlock({ x: e.target.value })}
            />
            <label className="block text-sm font-medium">Y Offset</label>
            <input
              type="text"
              className="mt-1 w-full border rounded p-2 text-sm"
              value={selectedBlock.data.y || '0px'}
              onChange={e => updateSelectedBlock({ y: e.target.value })}
            />
            <p className="text-xs text-gray-500 mt-2">Tip: You can also drag the logo directly on canvas.</p>
          </div>
        )}

        {selectedBlock.type === 'bullet_points' && (
          <div>
            <label className="block text-sm font-medium">Title (Optional)</label>
            <input type="text" className="mt-1 w-full border rounded p-2 mb-2 text-sm" value={selectedBlock.data.title || ''} onChange={e => updateSelectedBlock({ title: e.target.value })} />
            <label className="block text-sm font-medium mt-2">Bullet Points</label>
            {(selectedBlock.data.items || []).map((item, idx) => (
              <div key={idx} className="flex space-x-2 mt-1">
                <input type="text" className="w-full border rounded p-1 text-sm" value={item} onChange={e => {
                  const newItems = [...selectedBlock.data.items];
                  newItems[idx] = e.target.value;
                  updateSelectedBlock({ items: newItems });
                }}/>
                <button onClick={() => {
                  const newItems = selectedBlock.data.items.filter((_, i) => i !== idx);
                  updateSelectedBlock({ items: newItems });
                }} className="text-red-500 font-bold px-2">&times;</button>
              </div>
            ))}
            <button className="mt-1 text-indigo-600 text-sm font-medium" onClick={() => {
              const newItems = [...(selectedBlock.data.items || []), 'New Point'];
              updateSelectedBlock({ items: newItems });
            }}>+ Add Point</button>
          </div>
        )}

        {selectedBlock.type === 'signature_footer' && (
          <div>
            <label className="block text-sm font-medium">Signatory Name</label>
            <input type="text" className="mt-1 w-full border rounded p-2 mb-2 text-sm" value={selectedBlock.data.signatory_name || ''} onChange={e => updateSelectedBlock({ signatory_name: e.target.value })} />
            <label className="block text-sm font-medium">Signatory Title</label>
            <input type="text" className="mt-1 w-full border rounded p-2 mb-2 text-sm" value={selectedBlock.data.signatory_title || ''} onChange={e => updateSelectedBlock({ signatory_title: e.target.value })} />
            <label className="block text-sm font-medium">Company Name</label>
            <input type="text" className="mt-1 w-full border rounded p-2 mb-2 text-sm" value={selectedBlock.data.company_name || ''} onChange={e => updateSelectedBlock({ company_name: e.target.value })} />
          </div>
        )}

        {selectedBlock.type !== 'image' && (
          <div className="border-t pt-3">
            <div className="font-semibold text-sm mb-2">Text Style</div>
            <label className="block text-sm font-medium">Font Size (e.g. 16px, 1rem)</label>
            <input
              type="text"
              className="mt-1 w-full border rounded p-2 mb-2 text-sm"
              placeholder="16px"
              value={selectedBlock.data.font_size || ''}
              onChange={e => updateSelectedBlock({ font_size: e.target.value })}
            />
            <label className="block text-sm font-medium">Text Color</label>
            <input
              type="color"
              className="mt-1 h-10 w-full border rounded p-1"
              value={selectedBlock.data.text_color || '#1f2937'}
              onChange={e => updateSelectedBlock({ text_color: e.target.value })}
            />
          </div>
        )}

        <button 
          className="mt-4 bg-red-500 text-white px-3 py-1 rounded w-full text-sm font-medium hover:bg-red-600 transition-colors"
          onClick={() => {
            setBlocks(blocks.filter(b => b.id !== selectedBlock.id));
            setSelectedBlock(null);
          }}
        >
          Remove Block
        </button>
      </div>
    );
  };

  return (
    <div className="p-6 h-screen flex flex-col bg-gray-100">
      <div className="flex justify-between items-center mb-6 bg-white p-4 rounded shadow-sm border-b">
        <div className="flex items-center space-x-4">
          <button 
            onClick={() => {
              if (offerId && offerData?.candidate) {
                navigate(`/hr/candidates/${offerData.candidate}`, {
                  state: { returnTo: `/hr/builder?offer_id=${offerId}` },
                });
              } else {
                navigate('/hr/recruitment/jobs');
              }
            }}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            title="Back"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="text-xl font-bold text-gray-800">
            {offerId ? "Offer Letter Designer" : "Template Builder"}
          </h1>
          
          <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
            <button 
              onClick={() => setIsLayoutLocked(true)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${isLayoutLocked ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Fixed Layout
            </button>
            <button 
              onClick={() => setIsLayoutLocked(false)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${!isLayoutLocked ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Free Design
            </button>
          </div>

          {!offerId && (
            <div className="flex items-center space-x-2">
              <div className="flex items-center gap-1">
                <select 
                  className="border rounded p-1 text-sm focus:outline-none bg-gray-50"
                  value={selectedTemplateId}
                  onChange={handleTemplateChange}
                >
                  <option value="">-- Create New Template --</option>
                  {Array.from(new Set(templates.map(t => t.name))).map(name => {
                    const template = templates.find(t => t.name === name);
                    return (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    );
                  })}
                </select>
                {selectedTemplateId && (
                  <button 
                    onClick={deleteTemplate}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                    title="Delete this template"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <input 
                type="text" 
                className="border-b focus:outline-none p-1 w-48 text-sm"
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                placeholder="Template Name"
              />
            </div>
          )}
          
          {offerId && (
            <div className="flex items-center gap-2">
              <div className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
                Editing offer for: {offerData?.candidate_name}
              </div>
              <button 
                onClick={async () => {
                  const newName = prompt("Enter new template name:", `Template from ${offerData?.candidate_name}`);
                  if (newName) {
                    try {
                      await api.post('/hr/component-templates/', {
                        name: newName,
                        design_json: { blocks },
                        is_layout_locked: isLayoutLocked
                      });
                      toast.success("Saved as new template!");
                      loadTemplate(false);
                    } catch (err) {
                      toast.error("Failed to save template");
                    }
                  }
                }}
                className="flex items-center gap-1 px-3 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-full text-xs font-semibold border border-purple-200 transition-colors"
              >
                <Save size={14} />
                Save as Template
              </button>
            </div>
          )}
        </div>
        <div className="space-x-3 flex items-center">
          <button onClick={previewTemplate} className="flex items-center gap-2 px-4 py-2 border border-indigo-600 text-indigo-600 rounded hover:bg-indigo-50 transition-colors text-sm font-medium">
            <Eye size={18} />
            Preview
          </button>
          <button onClick={saveTemplate} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors text-sm font-medium shadow-sm">
            <Save size={18} />
            {offerId ? "Save Draft" : "Save Template"}
          </button>
          {offerId && (
            <button onClick={sendOffer} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors shadow-md text-sm font-medium">
              <Send size={18} />
              Send Offer
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 space-x-6 overflow-hidden">
        <DndContext onDragEnd={handleDragEnd}>
          <div className="w-64 bg-white p-4 rounded shadow-sm overflow-y-auto border-r">
            <h2 className="font-bold mb-4 text-gray-700 flex items-center gap-2">
              <PlusSquare size={18} />
              Components
            </h2>
            {BLOCKS.map(block => (
              <DraggableBlock key={block.type} block={block} disabled={isLayoutLocked} />
            ))}
            {isLayoutLocked && (
              <div className="mt-4 p-3 bg-blue-50 text-blue-700 text-xs rounded border border-blue-100 italic">
                Switch to "Free Design" mode to add or reorder blocks.
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto bg-gray-100 rounded-lg p-8 flex justify-center">
            <DroppableCanvas
              blocks={blocks}
              selectedBlock={selectedBlock}
              setSelectedBlock={setSelectedBlock}
              onUpdateBlock={updateBlockById}
              isLayoutLocked={isLayoutLocked}
            />
          </div>
        </DndContext>

        {!isLayoutLocked && (
          <div className="w-80 bg-white p-4 rounded shadow-sm overflow-y-auto border-l">
            {renderSettings()}
          </div>
        )}
      </div>

      {showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-6">
          <div className="bg-white rounded shadow-lg w-full max-w-5xl h-full flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <div>
                <h2 className="text-xl font-bold">Offer Letter Preview</h2>
                <p className="text-xs text-gray-500">This is how the final PDF will look.</p>
              </div>
              <button onClick={() => setShowPreview(false)} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors">Close Preview</button>
            </div>
            <div className="flex-1 overflow-auto p-8 bg-gray-100">
              <div className="max-w-3xl mx-auto bg-white p-12 shadow-sm min-h-full" dangerouslySetInnerHTML={{ __html: previewHtml }}></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
