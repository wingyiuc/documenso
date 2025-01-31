'use client';

import { useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import html2pdf from 'html2pdf.js';
import { Loader } from 'lucide-react';
import Mammoth from 'mammoth/mammoth.browser';
import { useSession } from 'next-auth/react';

import { useLimits } from '@documenso/ee/server-only/limits/provider/client';
import { createDocumentData } from '@documenso/lib/server-only/document-data/create-document-data';
import { putFile } from '@documenso/lib/universal/upload/put-file';
import { TRPCClientError } from '@documenso/trpc/client';
import { trpc } from '@documenso/trpc/react';
import { cn } from '@documenso/ui/lib/utils';
import { DocumentDropzone } from '@documenso/ui/primitives/document-dropzone';
import { useToast } from '@documenso/ui/primitives/use-toast';

export type UploadDocumentProps = {
  className?: string;
};

// eslint-disable-next-line @typescript-eslint/require-await
const generatePDF = async (htmlContent: string | Element): Promise<Blob> => {
  return html2pdf().from(htmlContent).output('blob');
};

const convertDocToPDF = async (file: File): Promise<File> => {
  try {
    if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const arrayBuffer = await file.arrayBuffer();
      const result = await Mammoth.convertToHtml({ arrayBuffer });
      const html = result.value;

      // Create a temporary element to hold the HTML content
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;

      // Use generatePDF to convert the HTML content to a PDF Blob
      const pdfBlob = await generatePDF(tempDiv);

      // Create and return a File object from the Blob
      const pdfFile = new File([pdfBlob], file.name.replace(/\.[^/.]+$/, '') + '.pdf', {
        type: 'application/pdf',
      });

      return pdfFile;
    } else {
      // Return the original file if it's not a DOCX file
      return file;
    }
  } catch (error) {
    console.error('Error converting document:', error);
    throw error;
  }
};

export const UploadDocument = ({ className }: UploadDocumentProps) => {
  const router = useRouter();
  const { data: session } = useSession();

  const { toast } = useToast();

  const { quota, remaining } = useLimits();

  const [isLoading, setIsLoading] = useState(false);

  const { mutateAsync: createDocument } = trpc.document.createDocument.useMutation();

  const onFileDrop = async (file: File) => {
    try {
      setIsLoading(true);
      let processedFile = file;
      if (
        file.type === 'application/msword' ||
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        processedFile = await convertDocToPDF(file);
      }

      const { type, data } = await putFile(processedFile);
      const { id: documentDataId } = await createDocumentData({
        type,
        data,
      });

      const { id } = await createDocument({
        title: file.name,
        documentDataId,
      });

      toast({
        title: 'Document uploaded',
        description: 'Your document has been uploaded successfully.',
        duration: 5000,
      });

      router.push(`/documents/${id}`);
    } catch (error) {
      console.error(error);

      if (error instanceof TRPCClientError) {
        toast({
          title: 'Error',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Error',
          description: 'An error occurred while uploading your document.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn('relative', className)}>
      <DocumentDropzone
        className="min-h-[40vh]"
        disabled={remaining.documents === 0 || !session?.user.emailVerified}
        onDrop={onFileDrop}
      />

      <div className="absolute -bottom-6 right-0">
        {remaining.documents > 0 && Number.isFinite(remaining.documents) && (
          <p className="text-muted-foreground/60 text-xs">
            {remaining.documents} of {quota.documents} documents remaining this month.
          </p>
        )}
      </div>

      {isLoading && (
        <div className="bg-background/50 absolute inset-0 flex items-center justify-center rounded-lg">
          <Loader className="text-muted-foreground h-12 w-12 animate-spin" />
        </div>
      )}

      {remaining.documents === 0 && (
        <div className="bg-background/60 absolute inset-0 flex items-center justify-center rounded-lg backdrop-blur-sm">
          <div className="text-center">
            <h2 className="text-muted-foreground/80 text-xl font-semibold">
              You have reached your document limit.
            </h2>

            <p className="text-muted-foreground/60 mt-2 text-sm">
              You can upload up to {quota.documents} documents per month on your current plan.
            </p>

            <Link
              className="text-primary hover:text-primary/80 mt-6 block font-medium"
              href="/settings/billing"
            >
              Upgrade your account to upload more documents.
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};
